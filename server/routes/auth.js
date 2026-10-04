const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { db } = require('../db/database');
const { ApiError } = require('../middleware/errors');
const { clearSessionCookie, issueSessionCookie, requireAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { schemas } = require('../validation');

const router = express.Router();
const dummyPasswordHash = bcrypt.hashSync('invalid-user-password', 12);
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => next(new ApiError(429, 'LOGIN_RATE_LIMITED', 'Too many login attempts. Try again later.'))
});

function getPublicUser(userId) {
  return db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.department_id, u.designation, u.avatar_url,
           d.name AS department_name
    FROM users u
    LEFT JOIN departments d ON u.department_id = d.id
    WHERE u.id = ? AND u.status = 'active'
  `).get(userId);
}

function devToolsEnabled() {
  return process.env.NODE_ENV === 'development' || process.env.ENABLE_DEV_TOOLS === 'true';
}

router.post('/login', loginLimiter, validateBody(schemas.login), async (req, res) => {
  const user = db.prepare(`
    SELECT id, email, role, password_hash
    FROM users
    WHERE email = ? AND status = 'active'
  `).get(req.body.email.toLowerCase());

  const passwordMatches = await bcrypt.compare(req.body.password, user?.password_hash || dummyPasswordHash);
  if (!user || !passwordMatches) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  issueSessionCookie(res, user.id);
  res.json({ success: true, user: getPublicUser(user.id), dev_tools_enabled: devToolsEnabled() });
});

router.post('/logout', validateBody(schemas.empty), (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, user: getPublicUser(req.user.id), dev_tools_enabled: devToolsEnabled() });
});

router.get('/users', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.department_id, u.designation, u.avatar_url, u.status,
           d.name AS department_name
    FROM users u
    LEFT JOIN departments d ON u.department_id = d.id
    WHERE u.status = 'active'
    ORDER BY u.role ASC, u.name ASC
  `).all();
  res.json({ success: true, users });
});

router.get('/departments', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  const departments = db.prepare('SELECT * FROM departments WHERE status = "active"').all();
  res.json({ success: true, departments });
});

router.get('/dev-users', requireAuth, (req, res, next) => {
  if (process.env.NODE_ENV !== 'development') {
    return next(new ApiError(404, 'DEV_TOOLS_DISABLED', 'Developer tools are disabled.'));
  }
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.department_id, u.designation, u.avatar_url, u.status,
           d.name AS department_name
    FROM users u
    LEFT JOIN departments d ON u.department_id = d.id
    WHERE u.status = 'active'
    ORDER BY u.role ASC, u.name ASC
  `).all();
  res.json({ success: true, users });
});

router.post('/dev-login', validateBody(schemas.devLogin), (req, res, next) => {
  if (process.env.NODE_ENV !== 'development') {
    return next(new ApiError(404, 'DEV_TOOLS_DISABLED', 'Developer tools are disabled.'));
  }
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(req.body.user_id);
  if (!user) return next(new ApiError(404, 'NOT_FOUND', 'User not found.'));
  issueSessionCookie(res, user.id);
  res.json({ success: true, user: getPublicUser(user.id), dev_tools_enabled: true });
});

module.exports = router;