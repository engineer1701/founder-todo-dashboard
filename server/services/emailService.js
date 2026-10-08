const { db, getEffectiveNowISO } = require('../db/database');
const { logAudit } = require('./auditService');
const nodemailer = require('nodemailer');

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;

function errorMessage(error) {
  let message = error?.message || String(error);
  const password = process.env.SMTP_PASS;
  if (password) message = message.split(password).join('[redacted]');
  return message.slice(0, 1000);
}

function saveResult(emailId, status, message, attempts) {
  if (!emailId) return;
  try {
    db.prepare(`
      UPDATE sent_emails
      SET status = ?, error_message = ?, attempt_count = ?, sent_at = ?
      WHERE id = ?
    `).run(status, message, attempts, getEffectiveNowISO(), emailId);
  } catch (error) {
    console.error(`[EmailService] Could not save delivery result: ${errorMessage(error)}`);
  }
}

function recordEmailAudit(taskId, recipientUserId, action, metadata) {
  try {
    logAudit(taskId, recipientUserId, action, metadata);
  } catch (error) {
    console.error(`[EmailService] Could not record email audit: ${errorMessage(error)}`);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getBaseUrl() {
  const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get('app_base_url');
  return process.env.APP_BASE_URL || row?.value || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function buildTaskLink(baseUrl, taskId) {
  const url = new URL('/', baseUrl);
  if (taskId !== undefined && taskId !== null) url.searchParams.set('task', String(taskId));
  return url.toString();
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
  const taskLink = buildTaskLink(baseUrl, variables.taskId);
  const mergedVars = {
    ...variables,
    link: taskLink
  };

  for (const [key, val] of Object.entries(mergedVars)) {
    const regex = new RegExp(`{{\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*}}`, 'g');
    const value = val !== undefined && val !== null ? String(val) : '';
    const subjectValue = value.replace(/[\\r\\n\\0]/g, ' ');
    subject = subject.replace(regex, subjectValue);
    body = body.replace(regex, key === 'link' ? escapeHtml(taskLink) : escapeHtml(value));
  }

  return { subject, bodyHtml: body, taskLink };
}

async function sendEmail({ taskId, recipientEmail, recipientName, recipientUserId, eventType, templateKey, variables = {} }) {
  let emailId = null;
  let subject = templateKey || eventType || 'Email';
  let taskLink = null;

  try {
    const rendered = renderTemplate(templateKey, variables);
    if (rendered) {
      subject = rendered.subject;
      taskLink = rendered.taskLink;
    }

    const now = getEffectiveNowISO();
    const insertResult = db.prepare(`
      INSERT INTO sent_emails (
        task_id, recipient_user_id, recipient_email, recipient_name, subject,
        body_html, event_type, sent_at, status, error_message, attempt_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed', 'Delivery pending', 0)
    `).run(
      taskId || null,
      recipientUserId || null,
      recipientEmail,
      recipientName || recipientEmail,
      subject,
      rendered?.bodyHtml || '',
      eventType || templateKey || 'Email',
      now
    );
    emailId = Number(insertResult.lastInsertRowid);

    if (!rendered) {
      const message = 'Email template not available or disabled.';
      saveResult(emailId, 'failed', message, 0);
      return { success: false, status: 'failed', emailId, subject, recipient: recipientEmail, attempts: 0, errorMessage: message };
    }

    if (!process.env.SMTP_HOST) {
      saveResult(emailId, 'simulated', null, 0);
      recordEmailAudit(taskId, recipientUserId, 'EMAIL_SIMULATED', { recipient: recipientEmail, eventType, subject });
      console.log(`[EmailService] Simulated "${subject}" to ${recipientEmail} [Event: ${eventType}]`);
      return { success: true, status: 'simulated', emailId, subject, recipient: recipientEmail, taskLink, attempts: 0 };
    }

    const port = Number(process.env.SMTP_PORT) || 587;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      ...(process.env.SMTP_USER || process.env.SMTP_PASS
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
        : {})
    });

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await transporter.sendMail({
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          to: recipientEmail,
          subject,
          html: rendered.bodyHtml
        });
        saveResult(emailId, 'sent', null, attempt);
        recordEmailAudit(taskId, recipientUserId, 'EMAIL_SENT', { recipient: recipientEmail, eventType, subject, attempts: attempt });
        console.log(`[EmailService] Sent "${subject}" to ${recipientEmail} [Event: ${eventType}]`);
        return { success: true, status: 'sent', emailId, subject, recipient: recipientEmail, taskLink, attempts: attempt };
      } catch (error) {
        lastError = errorMessage(error);
        saveResult(emailId, 'failed', lastError, attempt);
        if (attempt < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS * attempt);
      }
    }

    recordEmailAudit(taskId, recipientUserId, 'EMAIL_FAILED', {
      recipient: recipientEmail,
      eventType,
      subject,
      attempts: MAX_ATTEMPTS,
      error: lastError
    });
    console.error(`[EmailService] Failed to send to ${recipientEmail} [Event: ${eventType}; attempts: ${MAX_ATTEMPTS}]: ${lastError}`);
    return { success: false, status: 'failed', emailId, subject, recipient: recipientEmail, taskLink, attempts: MAX_ATTEMPTS, errorMessage: lastError };
  } catch (error) {
    const message = errorMessage(error);
    saveResult(emailId, 'failed', message, 0);
    console.error(`[EmailService] Email delivery error for ${recipientEmail}: ${message}`);
    return { success: false, status: 'failed', emailId, subject, recipient: recipientEmail, taskLink, attempts: 0, errorMessage: message };
  }
}

function getSentEmails(limit = 100, recipientUserId = null) {
  if (recipientUserId !== null) {
    return db.prepare(`
      SELECT * FROM sent_emails
      WHERE recipient_user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(recipientUserId, limit);
  }
  return db.prepare('SELECT * FROM sent_emails ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = {
  renderTemplate,
  sendEmail,
  getSentEmails,
  getBaseUrl
};
