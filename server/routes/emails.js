const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { getSentEmails } = require('../services/emailService');
const { requireRole } = require('../middleware/auth');
const { ApiError } = require('../middleware/errors');

// GET /api/emails - List recent sent emails
router.get('/', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const emails = getSentEmails(limit);
    res.json({ success: true, emails });
  } catch (err) {
    next(err);
  }
});

// GET /api/emails/:id - View single email HTML
router.get('/:id', (req, res, next) => {
  try {
    const email = db.prepare('SELECT * FROM sent_emails WHERE id = ?').get(req.params.id);
    if (!email) {
      return next(new ApiError(404, 'NOT_FOUND', 'Email not found.'));
    }
    res.json({ success: true, email });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/emails/clear - Clear email inbox for testing
router.delete('/clear', requireRole('founder', 'admin'), (req, res, next) => {
  try {
    db.prepare('DELETE FROM sent_emails').run();
    res.json({ success: true, message: 'Simulated email inbox cleared' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
