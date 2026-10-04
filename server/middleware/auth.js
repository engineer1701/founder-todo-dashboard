const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { db } = require('../db/database');
const { ApiError } = require('./errors');

const COOKIE_NAME = 'founder_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const developmentSecret = process.env.NODE_ENV === 'production'
  ? null
  : process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET || developmentSecret;
  if (!secret) throw new Error('SESSION_SECRET is required in production.');
  return secret;
}

function assertSecurityEnvironment() {
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required in production.');
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  };
}

function issueSessionCookie(res, userId) {
  const token = jwt.sign({ sub: String(userId) }, getSessionSecret(), { expiresIn: '8h' });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_DURATION_MS });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

function readCookie(req, name) {
  const item = (req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!item) return null;
  try {
    return decodeURIComponent(item.slice(name.length + 1));
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.'));

  let payload;
  try {
    payload = jwt.verify(token, getSessionSecret());
  } catch {
    return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.'));
  }

  const userId = Number(payload.sub);
  const user = Number.isSafeInteger(userId) && userId > 0
    ? db.prepare(`
      SELECT id, name, email, role, department_id, designation, avatar_url, status
      FROM users WHERE id = ? AND status = 'active'
    `).get(userId)
    : null;

  if (!user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.'));
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
    }
    next();
  };
}

function requireDevToolAccess(req, res, next) {
  if (req.user?.role === 'employee') {
    return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to use developer tools.'));
  }
  if (!['founder', 'admin'].includes(req.user?.role)) {
    return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to use developer tools.'));
  }
  if (process.env.NODE_ENV !== 'development' && process.env.ENABLE_DEV_TOOLS !== 'true') {
    return next(new ApiError(404, 'DEV_TOOLS_DISABLED', 'Developer tools are disabled.'));
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  assertSecurityEnvironment,
  clearSessionCookie,
  issueSessionCookie,
  requireAuth,
  requireDevToolAccess,
  requireRole
};