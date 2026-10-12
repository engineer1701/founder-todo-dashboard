PRAGMA foreign_keys = OFF;

CREATE TABLE task_reminders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id),
  reminder_type TEXT NOT NULL CHECK(reminder_type IN (
    'FIRST_REMINDER',
    'SECOND_REMINDER',
    'ESCALATION',
    'DEADLINE_APPROACHING',
    'DEADLINE_REACHED',
    'DEADLINE_OVERDUE',
    'MANUAL_REMINDER'
  )),
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  status TEXT DEFAULT 'sent' CHECK(status IN ('scheduled', 'sent', 'failed', 'cancelled')),
  attempt_count INTEGER DEFAULT 1,
  cycle_id TEXT,
  metadata TEXT
);

INSERT INTO task_reminders_new (
  id, task_id, recipient_user_id, reminder_type, scheduled_at, sent_at, status, attempt_count, cycle_id, metadata
)
SELECT
  id, task_id, recipient_user_id, reminder_type, scheduled_at, sent_at, status, attempt_count, cycle_id, metadata
FROM task_reminders;

DROP TABLE task_reminders;
ALTER TABLE task_reminders_new RENAME TO task_reminders;

CREATE INDEX IF NOT EXISTS idx_task_reminders_task_type ON task_reminders(task_id, reminder_type);

PRAGMA foreign_keys = ON;
