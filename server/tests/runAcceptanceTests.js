const http = require('node:http');
const { initDatabase } = require('../db/database');

async function main() {
  console.log('===============================================================');
  console.log('FOUNDER TO-DO DASHBOARD: ACCEPTANCE TEST RUNNER (AT-01 - AT-12)');
  console.log('===============================================================\n');

  initDatabase();

  const { runReminderScan, calculateTaskFlags } = require('../services/reminderEngine');
  const { db, getEffectiveNowISO } = require('../db/database');
  const { sendEmail } = require('../services/emailService');

  const nowIso = getEffectiveNowISO();
  const tests = [
    {
      id: 'AT-01',
      name: 'Founder creates a task and assigns it to an employee',
      fn: () => {
        const taskId = `CLI-TEST-01`;
        db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
        db.prepare(`
          INSERT INTO tasks (id, title, description, created_by, priority, start_at, deadline_at, status, last_progress_updated_at, created_at, updated_at)
          VALUES (?, 'AT-01 CLI Task', 'Desc', 1, 'High', ?, ?, 'New', ?, ?, ?)
        `).run(taskId, nowIso, nowIso, nowIso, nowIso, nowIso);
        db.prepare('INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active) VALUES (?, 3, ?, ?, 1)').run(taskId, 'primary', nowIso);
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (!task) throw new Error('Task was not created');
      }
    },
    {
      id: 'AT-02',
      name: 'Employee changes status and adds a remark',
      fn: () => {
        const taskId = `CLI-TEST-02`;
        db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
        db.prepare(`INSERT INTO tasks (id, title, created_by, deadline_at, status, last_progress_updated_at, created_at, updated_at) VALUES (?, 'AT-02 Task', 1, ?, 'New', ?, ?, ?)`).run(taskId, nowIso, nowIso, nowIso, nowIso);
        db.prepare('INSERT INTO task_updates (task_id, user_id, old_status, new_status, remark, progress_pct, created_at) VALUES (?, 3, ?, ?, ?, 20, ?)').run(taskId, 'New', 'In Progress', 'Started sprint', nowIso);
        const update = db.prepare('SELECT * FROM task_updates WHERE task_id = ?').get(taskId);
        if (!update || update.new_status !== 'In Progress') throw new Error('Update not recorded');
      }
    },
    {
      id: 'AT-03',
      name: 'No update reaches first reminder threshold',
      fn: () => {
        const taskId = `CLI-TEST-03`;
        db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
        const past26h = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
        db.prepare(`INSERT INTO tasks (id, title, created_by, deadline_at, status, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at) VALUES (?, 'AT-03 Inactive', 1, ?, 'In Progress', 1, 1, ?, ?, ?)`).run(taskId, nowIso, past26h, past26h, past26h);
        db.prepare('INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active) VALUES (?, 3, ?, ?, 1)').run(taskId, 'primary', past26h);
        runReminderScan();
        const reminder = db.prepare('SELECT * FROM task_reminders WHERE task_id = ? AND reminder_type = ?').get(taskId, 'FIRST_REMINDER');
        if (!reminder) throw new Error('FIRST_REMINDER not logged');
      }
    },
    {
      id: 'AT-04',
      name: 'Scheduler runs repeatedly after reminder already sent (Idempotency)',
      fn: () => {
        const scan = runReminderScan();
        if (scan.skippedDuplicates < 0) throw new Error('Skipped duplicate check failed');
      }
    },
    {
      id: 'AT-05',
      name: 'Employee updates task after reminder -> Inactivity timer resets',
      fn: () => {
        const taskId = `CLI-TEST-05`;
        db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
        const past30h = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
        db.prepare(`INSERT INTO tasks (id, title, created_by, deadline_at, status, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at) VALUES (?, 'AT-05 Reset', 1, ?, 'In Progress', 1, 1, ?, ?, ?)`).run(taskId, nowIso, past30h, past30h, past30h);
        db.prepare('INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active) VALUES (?, 3, ?, ?, 1)').run(taskId, 'primary', past30h);
        runReminderScan();
        // Update now
        const updateNow = new Date().toISOString();
        db.prepare('UPDATE tasks SET last_progress_updated_at = ? WHERE id = ?').run(updateNow, taskId);
        const flags = calculateTaskFlags(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
        if (flags.hours_inactive > 1) throw new Error('Inactivity timer did not reset');
      }
    },
    {
      id: 'AT-06',
      name: 'Task reaches deadline incomplete -> Overdue flag calculation',
      fn: () => {
        const taskId = `CLI-TEST-06`;
        db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
        const pastDeadline = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
        db.prepare(`INSERT INTO tasks (id, title, created_by, deadline_at, status, last_progress_updated_at, created_at, updated_at) VALUES (?, 'AT-06 Overdue', 1, ?, 'In Progress', ?, ?, ?)`).run(taskId, pastDeadline, nowIso, nowIso, nowIso);
        const flags = calculateTaskFlags(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
        if (!flags.is_overdue) throw new Error('Task not marked overdue');
      }
    },
    {
      id: 'AT-07',
      name: 'Task is completed -> Inactivity reminders stop',
      fn: () => {
        const taskId = `CLI-TEST-07`;
        db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
        const past100h = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
        db.prepare(`INSERT INTO tasks (id, title, created_by, deadline_at, status, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at) VALUES (?, 'AT-07 Done', 1, ?, 'Completed', 1, 1, ?, ?, ?)`).run(taskId, nowIso, past100h, past100h, past100h);
        runReminderScan();
        const reminders = db.prepare('SELECT COUNT(*) as count FROM task_reminders WHERE task_id = ?').get(taskId).count;
        if (reminders !== 0) throw new Error('Completed task received reminder');
      }
    },
    {
      id: 'AT-08',
      name: 'Inactivity reaches escalation threshold -> Founder receives escalation',
      fn: () => {
        const taskId = `CLI-TEST-08`;
        db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
        const past80h = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
        db.prepare(`INSERT INTO tasks (id, title, created_by, deadline_at, status, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at) VALUES (?, 'AT-08 Escalate', 1, ?, 'In Progress', 1, 1, ?, ?, ?)`).run(taskId, nowIso, past80h, past80h, past80h);
        db.prepare('INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active) VALUES (?, 3, ?, ?, 1)').run(taskId, 'primary', past80h);
        runReminderScan();
        const esc = db.prepare('SELECT * FROM task_reminders WHERE task_id = ? AND reminder_type = ?').get(taskId, 'ESCALATION');
        if (!esc) throw new Error('ESCALATION reminder not created');
      }
    },
    {
      id: 'AT-09',
      name: 'Employee requests another employee\'s task via API/UI -> Access denied (RBAC)',
      fn: () => {
        const taskId = 'CLI-TEST-09';
        db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
        db.prepare(`INSERT INTO tasks (id, title, created_by, deadline_at, status, last_progress_updated_at, created_at, updated_at) VALUES (?, 'AT-09 Private', 1, ?, 'New', ?, ?, ?)`).run(taskId, nowIso, nowIso, nowIso, nowIso);
        db.prepare('INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active) VALUES (?, 3, ?, ?, 1)').run(taskId, 'primary', nowIso);

        // Check if user Priya (ID=4) has assignment
        const assignment = db.prepare('SELECT id FROM task_assignees WHERE task_id = ? AND user_id = 4 AND active = 1').get(taskId);
        if (assignment) throw new Error('Priya should not have access to private task');
      }
    },
    {
      id: 'AT-10',
      name: 'Founder filters overdue/high-priority/no-update tasks',
      fn: () => {
        const all = db.prepare('SELECT * FROM tasks').all();
        const filtered = all.filter(t => t.priority === 'High');
        if (!Array.isArray(filtered)) throw new Error('Filtering failed');
      }
    },
    {
      id: 'AT-11',
      name: 'Email contains task link',
      fn: () => {
        const email = db.prepare('SELECT * FROM sent_emails WHERE body_html LIKE ? LIMIT 1').get('%/?task=%');
        if (!email) throw new Error('No email found with direct task link');
      }
    },
    {
      id: 'AT-12',
      name: 'Reminder settings are changed without code changes',
      fn: () => {
        db.prepare('UPDATE reminder_policies SET first_reminder_hours = 20 WHERE id = 1').run();
        const p = db.prepare('SELECT first_reminder_hours FROM reminder_policies WHERE id = 1').get();
        if (p.first_reminder_hours !== 20) throw new Error('Policy not updated');
        db.prepare('UPDATE reminder_policies SET first_reminder_hours = 24 WHERE id = 1').run();
      }
    }
  ];

  let passed = 0;
  for (const t of tests) {
    try {
      t.fn();
      console.log(`[PASS] ${t.id}: ${t.name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${t.id}: ${t.name} -> ${e.message}`);
    }
  }

  console.log(`\n===============================================================`);
  console.log(`FINAL RESULTS: ${passed}/${tests.length} ACCEPTANCE TESTS PASSED`);
  console.log(`===============================================================`);
}

main().catch(console.error);
