const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { runMigrations } = require('./migrate');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'tasks.db');
const schemaPath = path.join(__dirname, 'schema.sql');
const seedPath = path.join(__dirname, 'seed.sql');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

function initDatabase() {
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_INITIAL_PASSWORD) {
    throw new Error('ADMIN_INITIAL_PASSWORD is required in production.');
  }

  runMigrations(db);

  const seed = fs.readFileSync(seedPath, 'utf8');
  db.exec(seed);
  initializeSeedPasswords();

  // Check if we already have initial sample tasks; if not, populate standard demonstration tasks
  const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
  if (taskCount === 0) {
    seedInitialTasks();
  }
}

function initializeSeedPasswords() {
  if (process.env.NODE_ENV === 'production') {
    const emptyUsers = db.prepare('SELECT id, role FROM users WHERE password_hash IS NULL').all();
    const emptyDemoUsers = emptyUsers.filter((user) => user.role !== 'admin');
    if (emptyDemoUsers.length > 0 && !process.env.DEMO_USERS_PASSWORD) {
      throw new Error('DEMO_USERS_PASSWORD is required to initialize seeded non-admin users in production.');
    }
    for (const user of emptyUsers) {
      const password = user.role === 'admin'
        ? process.env.ADMIN_INITIAL_PASSWORD
        : process.env.DEMO_USERS_PASSWORD;
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(bcrypt.hashSync(password, 12), user.id);
    }
    return;
  }

  const missingPasswords = db.prepare('SELECT COUNT(*) AS count FROM users WHERE password_hash IS NULL').get().count;
  if (missingPasswords > 0) {
    const devPassword = process.env.DEV_SEED_PASSWORD || 'FounderDev2026!';
    const passwordHash = bcrypt.hashSync(devPassword, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE password_hash IS NULL').run(passwordHash);
  }
}

function getEffectiveNow() {
  // Check if an offset is configured for simulation
  const config = db.prepare('SELECT value FROM system_config WHERE key = ?').get('simulated_now_offset_hours');
  const offsetHours = config ? parseFloat(config.value) || 0 : 0;
  return new Date(Date.now() + offsetHours * 3600 * 1000);
}

function getEffectiveNowISO() {
  return getEffectiveNow().toISOString();
}

function seedInitialTasks() {
  const now = new Date();
  
  // Format ISO strings
  const fmt = (d) => d.toISOString();
  const hoursAgo = (h) => new Date(now.getTime() - h * 3600 * 1000);
  const hoursFromNow = (h) => new Date(now.getTime() + h * 3600 * 1000);

  // 1. Example Workflow Task from Section 12: "Collect 100 Customer Leads"
  const t1Created = hoursAgo(30);
  const t1Updated = hoursAgo(26); // Inactive for 26 hours -> will trigger 1st reminder on Standard Policy (24h)
  const t1Deadline = hoursFromNow(48);

  db.prepare(`
    INSERT INTO tasks (id, title, description, instructions, created_by, priority, start_at, deadline_at, status, progress_pct, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'TASK-101',
    'Collect 100 Customer Leads',
    'Source qualified B2B SaaS leads for product expansion into mid-market enterprise accounts.',
    '1. Filter LinkedIn Sales Navigator for VP of Engineering and Founders\n2. Verify verified emails with zero bounce\n3. Populate CRM pipeline table',
    1, // Founder Vikram
    'High',
    fmt(t1Created),
    fmt(t1Deadline),
    'In Progress',
    35,
    1, // Standard Policy (24/48/72)
    1,
    fmt(t1Updated),
    fmt(t1Created),
    fmt(t1Updated)
  );

  db.prepare(`
    INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
    VALUES (?, ?, ?, ?, 1)
  `).run('TASK-101', 3, 'primary', fmt(t1Created)); // Rahul Sharma (HR / Talent)

  db.prepare(`
    INSERT INTO task_updates (task_id, user_id, old_status, new_status, remark, progress_pct, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('TASK-101', 3, 'New', 'In Progress', 'Began prospecting companies on Apollo and LinkedIn. First batch of 35 verified.', 35, fmt(t1Updated));

  // 2. Critical engineering task with approaching deadline
  const t2Created = hoursAgo(10);
  const t2Updated = hoursAgo(2);
  const t2Deadline = hoursFromNow(8); // Due in 8 hours (under 12h threshold)

  db.prepare(`
    INSERT INTO tasks (id, title, description, instructions, created_by, priority, start_at, deadline_at, status, progress_pct, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'TASK-102',
    'Payment Gateway Webhook Idempotency Fix',
    'Ensure webhook retries from Stripe/Razorpay do not duplicate order confirmation events or dispatch double webhooks.',
    'Implement Redis-backed idempotency key checks and automated reconciliation job.',
    1,
    'Critical',
    fmt(t2Created),
    fmt(t2Deadline),
    'In Progress',
    70,
    1,
    1,
    fmt(t2Updated),
    fmt(t2Created),
    fmt(t2Updated)
  );

  db.prepare(`
    INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
    VALUES (?, ?, ?, ?, 1)
  `).run('TASK-102', 4, 'primary', fmt(t2Created)); // Priya Patel

  db.prepare(`
    INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
    VALUES (?, ?, ?, ?, 1)
  `).run('TASK-102', 3, 'contributor', fmt(t2Created)); // Rahul as secondary

  db.prepare(`
    INSERT INTO task_updates (task_id, user_id, old_status, new_status, remark, progress_pct, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('TASK-102', 4, 'Acknowledged', 'In Progress', 'Unit tests passing, deploying migration to staging now.', 70, fmt(t2Updated));

  // 3. Overdue task (demonstrating Section 4 calculated overdue flag without silently overwriting actual status)
  const t3Created = hoursAgo(80);
  const t3Updated = hoursAgo(55); // Inactive 55h -> triggers 2nd reminder
  const t3Deadline = hoursAgo(10); // Deadline passed 10 hours ago -> OVERDUE!

  db.prepare(`
    INSERT INTO tasks (id, title, description, instructions, created_by, priority, start_at, deadline_at, status, progress_pct, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'TASK-103',
    'Q3 SOC2 Compliance Documentation Audit',
    'Finalize vendor security questionnaires and provide access logs for auditor inspection.',
    'Compile AWS IAM access reviews, SSO logs, and employee offboarding checklists.',
    2, // Admin Ananya
    'High',
    fmt(t3Created),
    fmt(t3Deadline),
    'Awaiting Information',
    50,
    1,
    1,
    fmt(t3Updated),
    fmt(t3Created),
    fmt(t3Updated)
  );

  db.prepare(`
    INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
    VALUES (?, ?, ?, ?, 1)
  `).run('TASK-103', 5, 'primary', fmt(t3Created)); // Amit Verma

  // 4. Completed task (reminders must stop)
  const t4Created = hoursAgo(100);
  const t4Updated = hoursAgo(12);
  const t4Deadline = hoursAgo(20);

  db.prepare(`
    INSERT INTO tasks (id, title, description, instructions, created_by, priority, start_at, deadline_at, status, progress_pct, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'TASK-104',
    'Customer Onboarding Tutorial Screen Designs',
    'Design interactive product walkthrough cards for self-serve signups.',
    'Follow Figma guidelines and export SVG icon sets.',
    1,
    'Medium',
    fmt(t4Created),
    fmt(t4Deadline),
    'Completed',
    100,
    1,
    1,
    fmt(t4Updated),
    fmt(t4Created),
    fmt(t4Updated)
  );

  db.prepare(`
    INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
    VALUES (?, ?, ?, ?, 1)
  `).run('TASK-104', 6, 'primary', fmt(t4Created)); // Neha Gupta

  // 5. New task awaiting employee acknowledgment
  const t5Created = hoursAgo(3);
  const t5Deadline = hoursFromNow(72);

  db.prepare(`
    INSERT INTO tasks (id, title, description, instructions, created_by, priority, start_at, deadline_at, status, progress_pct, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'TASK-105',
    'Prepare Q4 Growth Marketing Forecast',
    'Synthesize CAC, LTV and pay-per-click conversion metrics across Google, Meta and LinkedIn.',
    'Present in Monday executive leadership review.',
    1,
    'High',
    fmt(t5Created),
    fmt(t5Deadline),
    'New',
    0,
    1,
    1,
    fmt(t5Created),
    fmt(t5Created),
    fmt(t5Created)
  );

  db.prepare(`
    INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
    VALUES (?, ?, ?, ?, 1)
  `).run('TASK-105', 5, 'primary', fmt(t5Created)); // Amit Verma

  // Seed sample comments
  db.prepare(`
    INSERT INTO task_comments (task_id, user_id, comment, created_at)
    VALUES (?, ?, ?, ?)
  `).run('TASK-101', 1, 'Rahul, prioritize leads with over 50 employees and Series A+ funding.', fmt(hoursAgo(28)));

  db.prepare(`
    INSERT INTO task_comments (task_id, user_id, comment, created_at)
    VALUES (?, ?, ?, ?)
  `).run('TASK-101', 3, 'Understood Vikram. Filtering for healthcare and fintech SaaS verticals specifically.', fmt(hoursAgo(27)));

  // Seed initial audit log
  db.prepare(`
    INSERT INTO audit_logs (task_id, actor_user_id, action, metadata, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('TASK-101', 1, 'TASK_CREATED', JSON.stringify({ priority: 'High', assignee: 'Rahul Sharma' }), fmt(t1Created));
}

module.exports = {
  db,
  initDatabase,
  getEffectiveNow,
  getEffectiveNowISO
};
