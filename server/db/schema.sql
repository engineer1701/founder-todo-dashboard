-- Schema for Founder To-Do Allocation & Follow-Up Dashboard
-- Internal Task Management System • Version 1.0 • 29 September 2026

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('founder', 'employee', 'admin')),
  department_id INTEGER REFERENCES departments(id),
  designation TEXT,
  avatar_url TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER DEFAULT 1,
  first_reminder_hours REAL DEFAULT 24,
  second_reminder_hours REAL DEFAULT 48,
  escalation_hours REAL DEFAULT 72,
  deadline_reminder_hours REAL DEFAULT 12,
  repeat_enabled INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  priority TEXT DEFAULT 'Medium' CHECK(priority IN ('Critical', 'High', 'Medium', 'Low')),
  start_at TEXT,
  deadline_at TEXT NOT NULL,
  status TEXT DEFAULT 'New' CHECK(status IN (
    'New',
    'Acknowledged',
    'In Progress',
    'Awaiting Information',
    'On Hold',
    'Submitted for Review',
    'Rework Required',
    'Completed',
    'Approved',
    'Cancelled'
  )),
  progress_pct INTEGER DEFAULT 0,
  recurrence_rule TEXT,
  reminder_policy_id INTEGER REFERENCES reminder_policies(id),
  email_notifications_enabled INTEGER DEFAULT 1,
  last_progress_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_assignees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  responsibility_type TEXT DEFAULT 'primary' CHECK(responsibility_type IN ('primary', 'contributor', 'reviewer')),
  assigned_at TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  UNIQUE(task_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  old_status TEXT,
  new_status TEXT NOT NULL,
  remark TEXT NOT NULL,
  progress_pct INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  file_type TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id),
  reminder_type TEXT NOT NULL CHECK(reminder_type IN (
    'FIRST_REMINDER',
    'SECOND_REMINDER',
    'ESCALATION',
    'DEADLINE_APPROACHING',
    'DEADLINE_OVERDUE',
    'MANUAL_REMINDER'
  )),
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  status TEXT DEFAULT 'sent' CHECK(status IN ('scheduled', 'sent', 'failed', 'cancelled')),
  attempt_count INTEGER DEFAULT 1,
  cycle_id TEXT, -- Key associated with the current inactivity or deadline cycle to prevent duplicate notifications
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sent_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  event_type TEXT NOT NULL,
  sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Indexes for performance as specified in Section 14
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline_at);
CREATE INDEX IF NOT EXISTS idx_tasks_last_updated ON tasks(last_progress_updated_at);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);
CREATE INDEX IF NOT EXISTS idx_task_reminders_task_type ON task_reminders(task_id, reminder_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_task ON audit_logs(task_id);
