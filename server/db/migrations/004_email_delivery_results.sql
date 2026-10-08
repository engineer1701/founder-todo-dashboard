ALTER TABLE sent_emails ADD COLUMN status TEXT NOT NULL DEFAULT 'simulated'
  CHECK (status IN ('sent', 'failed', 'simulated'));

ALTER TABLE sent_emails ADD COLUMN error_message TEXT;
ALTER TABLE sent_emails ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;