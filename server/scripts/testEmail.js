require('dotenv').config();
const { initDatabase } = require('../db/database');
const { sendEmail } = require('../services/emailService');

async function main() {
  const recipientEmail = process.argv[2]?.trim();
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    throw new Error('Usage: npm run test:email -- <recipient-email>');
  }

  initDatabase();
  const result = await sendEmail({
    recipientEmail,
    recipientName: recipientEmail,
    eventType: 'Email Test',
    templateKey: 'NEW_TASK_ASSIGNED',
    variables: {
      task_id: 'EMAIL-TEST',
      task_title: 'SMTP configuration test',
      description: 'Test message from Founder To-Do Allocation & Follow-Up Dashboard.',
      assignee_name: recipientEmail,
      creator_name: 'Founder Task Dashboard',
      priority: 'Low',
      deadline: new Date().toISOString()
    }
  });

  console.log(JSON.stringify({
    status: result.status,
    recipient: result.recipient,
    attempts: result.attempts,
    error: result.errorMessage || null,
    emailId: result.emailId
  }, null, 2));

  if (!result.success) process.exitCode = 1;
}

main().catch((error) => {
  const password = process.env.SMTP_PASS;
  const message = password ? error.message.split(password).join('[redacted]') : error.message;
  console.error(message);
  process.exitCode = 1;
});