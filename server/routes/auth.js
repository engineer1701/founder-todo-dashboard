const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

// GET /api/users - List users for assignment and role-switcher
router.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.department_id, u.designation, u.avatar_url, u.status,
             d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.status = 'active'
      ORDER BY u.role ASC, u.name ASC
    `).all();

    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/departments - List departments
router.get('/departments', (req, res) => {
  try {
    const departments = db.prepare('SELECT * FROM departments WHERE status = "active"').all();
    res.json({ success: true, departments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/auth/me - Current user info
router.get('/me', (req, res) => {
  try {
    const userIdHeader = req.headers['x-user-id'] || req.query.current_user_id || 1;
    const user = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.department_id, u.designation, u.avatar_url,
             d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = ?
    `).get(userIdHeader);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
