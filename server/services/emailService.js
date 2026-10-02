const { db, getEffectiveNowISO } = require('../db/database');
const { logAudit } = require('./auditService');

function getBaseUrl() {
  const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get('app_base_url');
  return row ? row.value : 'http://localhost:5173';
}

function renderTemplate(templateKey, variables) {
  const tpl = db.prepare('SELECT * FROM email_templates WHERE template_key = ? AND enabled = 1').get(templateKey);
  if (!tpl) {
    console.warn(`[EmailService] Template "${templateKey}" not found or disabled.`);
    return null;
  }

  let subject = tpl.subject;
  let body = tpl.body;

  const baseUrl = getBaseUrl();
  const taskLink = variables.taskId ? `${baseUrl}/?task=${variables.taskId}` : baseUrl;
  
  const mergedVars = {
    ...variables,
    task_link: taskLink,
    app_url: baseUrl
  };

  for (const [key, val] of Object.entries(mergedVars)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    const safeVal = val !== undefined && val !== null ? String(val) : '';
    subject = subject.replace(regex, safeVal);
    body = body.replace(regex, safeVal);
  }

  return { subject, bodyHtml: body, taskLink };
}

function sendEmail({ taskId, recipientEmail, recipientName, recipientUserId, eventType, templateKey, variables }) {
  const rendered = renderTemplate(templateKey, variables);
  if (!rendered) {
    return { success: false, reason: 'Template not available' };
  }

  const now = getEffectiveNowISO();

  // Save to sent_emails store for in-app inspection & simulation
  const insertEmail = db.prepare(`
    INSERT INTO sent_emails (task_id, recipient_email, recipient_name, subject, body_html, event_type, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = insertEmail.run(
    taskId || null,
    recipientEmail,
    recipientName || recipientEmail,
    rendered.subject,
    rendered.bodyHtml,
    eventType,
    now
  );

  console.log(`[EmailService] Sent "${rendered.subject}" to ${recipientEmail} [Event: ${eventType}]`);

  // Log in audit trail
  logAudit(taskId, recipientUserId || null, 'EMAIL_SENT', {
    recipient: recipientEmail,
    eventType,
    subject: rendered.subject
  });

  return {
    success: true,
    emailId: result.lastInsertRowid,
    subject: rendered.subject,
    recipient: recipientEmail,
    taskLink: rendered.taskLink
  };
}

function getSentEmails(limit = 100) {
  return db.prepare(`
    SELECT * FROM sent_emails
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  renderTemplate,
  sendEmail,
  getSentEmails,
  getBaseUrl
};
