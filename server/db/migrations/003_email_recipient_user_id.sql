ALTER TABLE sent_emails ADD COLUMN recipient_user_id INTEGER REFERENCES users(id);

UPDATE sent_emails
SET recipient_user_id = (
  SELECT users.id FROM users WHERE users.email = sent_emails.recipient_email
)
WHERE recipient_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sent_emails_recipient ON sent_emails(recipient_user_id, id);