const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { getSentEmails } = require('../services/emailService');

// GET /api/emails - List recent sent emails
router.get('/', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const emails = getSentEmails(limit);
    res.json({ success: true, emails });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/emails/:id - View single email HTML
router.get('/:id', (req, res) => {
  try {
    const email = db.prepare('SELECT * FROM sent_emails WHERE id = ?').get(req.params.id);
    if (!email) {
      return res.status(404).json({ success: false, error: 'Email not found' });
    }
    res.json({ success: true, email });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/emails/clear - Clear email inbox for testing
router.delete('/clear', (req, res) => {
  try {
    db.prepare('DELETE FROM sent_emails').run();
    res.json({ success: true, message: 'Simulated email inbox cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
