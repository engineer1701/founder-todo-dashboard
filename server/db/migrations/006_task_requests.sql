CREATE TABLE IF NOT EXISTS task_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  request_type TEXT NOT NULL CHECK(request_type IN ('CLARIFICATION', 'EXTENSION')),
  message TEXT NOT NULL,
  requested_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  final_deadline TEXT
);
