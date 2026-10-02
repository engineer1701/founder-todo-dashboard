const express = require('express');
const router = express.Router();
const { db, getEffectiveNow, getEffectiveNowISO } = require('../db/database');
const { runReminderScan } = require('../services/reminderEngine');
const { logAudit } = require('../services/auditService');

// -------------------------------------------------------------
// GET /api/settings/reminders - Get reminder settings (Section 8)
// -------------------------------------------------------------
router.get('/reminders', (req, res) => {
  try {
    const policies = db.prepare('SELECT * FROM reminder_policies ORDER BY id ASC').all();
    const configRows = db.prepare('SELECT key, value FROM system_config').all();
    const config = {};
    for (const r of configRows) {
      config[r.key] = r.value;
    }

    res.json({
      success: true,
      policies,
      config
    });
  } catch (err) {
    console.error('[GET /api/settings/reminders error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// PUT /api/settings/reminders - Update reminder settings (Section 8, AT-12)
// -------------------------------------------------------------
router.put('/reminders', (req, res) => {
  try {
    const { policy_id, first_reminder_hours, second_reminder_hours, escalation_hours, deadline_reminder_hours, repeat_enabled, enabled } = req.body;
    const nowIso = getEffectiveNowISO();

    if (!policy_id) {
      return res.status(400).json({ success: false, error: 'policy_id is required' });
    }

    db.prepare(`
      UPDATE reminder_policies
      SET first_reminder_hours = COALESCE(?, first_reminder_hours),
          second_reminder_hours = COALESCE(?, second_reminder_hours),
          escalation_hours = COALESCE(?, escalation_hours),
          deadline_reminder_hours = COALESCE(?, deadline_reminder_hours),
          repeat_enabled = COALESCE(?, repeat_enabled),
          enabled = COALESCE(?, enabled),
          updated_at = ?
      WHERE id = ?
    `).run(
      first_reminder_hours !== undefined ? parseFloat(first_reminder_hours) : null,
      second_reminder_hours !== undefined ? parseFloat(second_reminder_hours) : null,
      escalation_hours !== undefined ? parseFloat(escalation_hours) : null,
      deadline_reminder_hours !== undefined ? parseFloat(deadline_reminder_hours) : null,
      repeat_enabled !== undefined ? (repeat_enabled ? 1 : 0) : null,
      enabled !== undefined ? (enabled ? 1 : 0) : null,
      nowIso,
      parseInt(policy_id, 10)
    );

    logAudit(null, 1, 'REMINDER_SETTINGS_UPDATED', req.body);

    const updated = db.prepare('SELECT * FROM reminder_policies WHERE id = ?').get(policy_id);

    res.json({
      success: true,
      message: 'Reminder configuration updated successfully without code rewrite (AT-12 compliant).',
      policy: updated
    });
  } catch (err) {
    console.error('[PUT /api/settings/reminders error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// GET & PUT /api/settings/templates - Email Templates Management
// -------------------------------------------------------------
router.get('/templates', (req, res) => {
  try {
    const templates = db.prepare('SELECT * FROM email_templates ORDER BY id ASC').all();
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/templates/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { subject, body, enabled } = req.body;
    const nowIso = getEffectiveNowISO();

    db.prepare(`
      UPDATE email_templates
      SET subject = COALESCE(?, subject),
          body = COALESCE(?, body),
          enabled = COALESCE(?, enabled),
          updated_at = ?
      WHERE id = ?
    `).run(
      subject !== undefined ? subject : null,
      body !== undefined ? body : null,
      enabled !== undefined ? (enabled ? 1 : 0) : null,
      nowIso,
      parseInt(id, 10)
    );

    logAudit(null, 1, 'EMAIL_TEMPLATE_UPDATED', { templateId: id });
    res.json({ success: true, message: 'Template updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// System Config (Business hours, timezone, simulated time offset)
// -------------------------------------------------------------
router.put('/config', (req, res) => {
  try {
    const { config } = req.body; // { key: value }
    const nowIso = getEffectiveNowISO();

    for (const [key, value] of Object.entries(config || {})) {
      db.prepare(`
        INSERT INTO system_config (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(key, String(value), nowIso);
    }

    res.json({ success: true, message: 'Configuration saved' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Manual Trigger / Simulator for Scheduler pass
// -------------------------------------------------------------
router.post('/scheduler/run', (req, res) => {
  try {
    const result = runReminderScan();
    res.json({
      success: true,
      message: 'Reminder engine scan completed.',
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Time Simulation: fast-forward system time to test inactivity thresholds
// -------------------------------------------------------------
router.post('/simulate-time', (req, res) => {
  try {
    const { advance_hours, reset } = req.body;
    let newOffset = 0;
    const nowIso = getEffectiveNowISO();

    if (reset) {
      newOffset = 0;
    } else {
      const current = db.prepare('SELECT value FROM system_config WHERE key = "simulated_now_offset_hours"').get();
      const currentOffset = current ? parseFloat(current.value) || 0 : 0;
      newOffset = currentOffset + (parseFloat(advance_hours) || 0);
    }

    db.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES ('simulated_now_offset_hours', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(String(newOffset), nowIso);

    const effectiveNow = getEffectiveNow();

    res.json({
      success: true,
      offset_hours: newOffset,
      simulated_time_iso: effectiveNow.toISOString(),
      simulated_time_ist: effectiveNow.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
