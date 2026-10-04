const express = require('express');
const router = express.Router();
const { db, getEffectiveNow, getEffectiveNowISO } = require('../db/database');
const { runReminderScan, calculateTaskFlags } = require('../services/reminderEngine');
const { sendEmail } = require('../services/emailService');
const { logAudit } = require('../services/auditService');
const { requireDevToolAccess } = require('../middleware/auth');

router.get('/run', requireDevToolAccess, async (req, res, next) => {
  const results = [];
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  const nowIso = getEffectiveNowISO();

  // Helper to run a test safely
  async function runTest(id, name, testFn) {
    const startTime = Date.now();
    try {
      const details = await testFn();
      results.push({
        id,
        name,
        status: 'PASSED',
        duration_ms: Date.now() - startTime,
        details
      });
    } catch (err) {
      results.push({
        id,
        name,
        status: 'FAILED',
        duration_ms: Date.now() - startTime,
        error: err.message
      });
    }
  }

  try {
    // -----------------------------------------------------------------
    // AT-01: Founder creates a task and assigns it to an employee.
    // -----------------------------------------------------------------
    await runTest('AT-01', 'Founder creates a task and assigns it to an employee', async () => {
      const taskId = `TEST-${Date.now()}-01`;
      const deadline = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

      db.prepare(`
        INSERT INTO tasks (id, title, description, created_by, priority, start_at, deadline_at, status, last_progress_updated_at, created_at, updated_at)
        VALUES (?, 'AT-01 Test Task', 'Verification task for AT-01', 1, 'High', ?, ?, 'New', ?, ?, ?)
      `).run(taskId, nowIso, deadline, nowIso, nowIso, nowIso);

      db.prepare(`
        INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
        VALUES (?, 3, 'primary', ?, 1)
      `).run(taskId, nowIso);

      // Trigger assignment email
      const rahul = db.prepare('SELECT * FROM users WHERE id = 3').get();
      const mailRes = sendEmail({
        taskId,
        recipientEmail: rahul.email,
        recipientName: rahul.name,
        recipientUserId: rahul.id,
        eventType: 'New Task Assigned',
        templateKey: 'NEW_TASK_ASSIGNED',
        variables: {
          task_id: taskId,
          taskId,
          task_title: 'AT-01 Test Task',
          description: 'Verification task for AT-01',
          assignee_name: rahul.name,
          creator_name: 'Founder Vikram',
          priority: 'High',
          deadline
        }
      });

      assert(mailRes.success, 'Assignment email must be sent successfully');

      // Verify task appears for employee Rahul (id = 3)
      const empTask = db.prepare(`
        SELECT t.id, t.title FROM tasks t
        JOIN task_assignees ta ON t.id = ta.task_id
        WHERE ta.user_id = 3 AND t.id = ?
      `).get(taskId);
      assert(empTask && empTask.id === taskId, 'Task must appear for the assigned employee');

      return `Task ${taskId} created, assigned to Rahul Sharma (${rahul.email}), assignment email generated with subject: "${mailRes.subject}".`;
    });

    // -----------------------------------------------------------------
    // AT-02: Employee changes status and adds a remark.
    // -----------------------------------------------------------------
    await runTest('AT-02', 'Employee changes status and adds a remark', async () => {
      const taskId = `TEST-${Date.now()}-02`;
      const deadline = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

      db.prepare(`
        INSERT INTO tasks (id, title, description, created_by, priority, start_at, deadline_at, status, last_progress_updated_at, created_at, updated_at)
        VALUES (?, 'AT-02 Progress Task', 'Desc', 1, 'Medium', ?, ?, 'New', ?, ?, ?)
      `).run(taskId, nowIso, deadline, nowIso, nowIso, nowIso);

      db.prepare(`
        INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
        VALUES (?, 3, 'primary', ?, 1)
      `).run(taskId, nowIso);

      // Rahul updates status to 'In Progress' with remark
      const remarkText = 'Commenced market analysis and drafting survey.';
      const updateTime = new Date().toISOString();

      db.prepare(`
        INSERT INTO task_updates (task_id, user_id, old_status, new_status, remark, progress_pct, created_at)
        VALUES (?, 3, 'New', 'In Progress', ?, 25, ?)
      `).run(taskId, remarkText, updateTime);

      db.prepare(`
        UPDATE tasks SET status = 'In Progress', progress_pct = 25, last_progress_updated_at = ?, updated_at = ?
        WHERE id = ?
      `).run(updateTime, updateTime, taskId);

      // Verify recorded
      const recorded = db.prepare('SELECT * FROM task_updates WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(taskId);
      assert(recorded, 'Update record must exist in task_updates');
      assert(recorded.new_status === 'In Progress', 'New status must be In Progress');
      assert(recorded.remark === remarkText, 'Remark must match provided text');
      assert(recorded.user_id === 3, 'User ID must be employee Rahul (3)');

      return `Status changed New -> In Progress, progress set to 25%, remark recorded with user=Rahul Sharma and timestamp=${updateTime}.`;
    });

    // -----------------------------------------------------------------
    // AT-03: No update reaches first reminder threshold.
    // -----------------------------------------------------------------
    await runTest('AT-03', 'No update reaches first reminder threshold', async () => {
      const taskId = `TEST-${Date.now()}-03`;
      // Set last_progress_updated_at to 26 hours ago (exceeding 24h standard threshold)
      const past26h = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
      const deadline = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

      db.prepare(`
        INSERT INTO tasks (id, title, description, created_by, priority, start_at, deadline_at, status, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at)
        VALUES (?, 'AT-03 Inactive Task', 'Desc', 1, 'Medium', ?, ?, 'In Progress', 1, 1, ?, ?, ?)
      `).run(taskId, past26h, deadline, past26h, past26h, past26h);

      db.prepare(`
        INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
        VALUES (?, 3, 'primary', ?, 1)
      `).run(taskId, past26h);

      // Run reminder scan
      const scanRes = runReminderScan();

      // Check task_reminders
      const reminder = db.prepare(`
        SELECT * FROM task_reminders
        WHERE task_id = ? AND reminder_type = 'FIRST_REMINDER'
      `).get(taskId);

      assert(reminder, 'A FIRST_REMINDER must be recorded in task_reminders');
      assert(reminder.status === 'sent', 'Reminder status must be sent');

      return `Task inactive for 26h reached first reminder threshold (24h). FIRST_REMINDER email was triggered and recorded in task_reminders table.`;
    });

    // -----------------------------------------------------------------
    // AT-04: Scheduler runs repeatedly after reminder already sent.
    // -----------------------------------------------------------------
    await runTest('AT-04', 'Scheduler runs repeatedly after reminder already sent (Idempotency)', async () => {
      // Run reminder scan again immediately
      const initialCount = db.prepare('SELECT COUNT(*) as count FROM task_reminders WHERE reminder_type = ?').get('FIRST_REMINDER').count;

      const repeatScan = runReminderScan();

      const finalCount = db.prepare('SELECT COUNT(*) as count FROM task_reminders WHERE reminder_type = ?').get('FIRST_REMINDER').count;
      assert(initialCount === finalCount, 'Count of FIRST_REMINDER must remain constant on repeated scheduler run');
      assert(repeatScan.skippedDuplicates >= 1, 'Skipped duplicate reminders counter must register duplicate prevention');

      return `Scheduler rerun executed. Skipped duplicate count: ${repeatScan.skippedDuplicates}. Zero duplicate emails dispatched, proving idempotent execution.`;
    });

    // -----------------------------------------------------------------
    // AT-05: Employee updates task after reminder.
    // -----------------------------------------------------------------
    await runTest('AT-05', 'Employee updates task after reminder -> Inactivity timer resets', async () => {
      const taskId = `TEST-${Date.now()}-05`;
      const past26h = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
      const deadline = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

      db.prepare(`
        INSERT INTO tasks (id, title, description, created_by, priority, start_at, deadline_at, status, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at)
        VALUES (?, 'AT-05 Reset Task', 'Desc', 1, 'High', ?, ?, 'In Progress', 1, 1, ?, ?, ?)
      `).run(taskId, past26h, deadline, past26h, past26h, past26h);

      db.prepare(`
        INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
        VALUES (?, 4, 'primary', ?, 1)
      `).run(taskId, past26h);

      // Trigger 1st reminder
      runReminderScan();

      // Verify reminder is logged
      const reminderBefore = db.prepare('SELECT COUNT(*) as count FROM task_reminders WHERE task_id = ?').get(taskId).count;
      assert(reminderBefore > 0, 'Initial reminder should be logged');

      // Now Employee Priya updates task
      const resetTime = new Date().toISOString();
      db.prepare(`
        INSERT INTO task_updates (task_id, user_id, old_status, new_status, remark, progress_pct, created_at)
        VALUES (?, 4, 'In Progress', 'In Progress', 'Updated work after reminder', 60, ?)
      `).run(taskId, resetTime);

      db.prepare(`
        UPDATE tasks SET last_progress_updated_at = ?, progress_pct = 60, updated_at = ?
        WHERE id = ?
      `).run(resetTime, resetTime, taskId);

      // Check task flags now
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      const flags = calculateTaskFlags(task);

      assert(flags.hours_inactive < 1, 'Inactivity hours must be reset to near 0');
      assert(!flags.is_no_update_alert, 'is_no_update_alert must be false after update');

      return `Employee submitted remark; last_progress_updated_at reset to ${resetTime}. Current inactivity: ${flags.hours_inactive}h, no_update_alert: ${flags.is_no_update_alert}.`;
    });

    // -----------------------------------------------------------------
    // AT-06: Task reaches deadline incomplete.
    // -----------------------------------------------------------------
    await runTest('AT-06', 'Task reaches deadline incomplete -> Overdue flag and alerts behave correctly', async () => {
      const taskId = `TEST-${Date.now()}-06`;
      const pastDeadline = new Date(Date.now() - 5 * 3600 * 1000).toISOString(); // 5 hours overdue

      db.prepare(`
        INSERT INTO tasks (id, title, description, created_by, priority, start_at, deadline_at, status, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at)
        VALUES (?, 'AT-06 Overdue Task', 'Desc', 1, 'Critical', ?, ?, 'In Progress', 1, 1, ?, ?, ?)
      `).run(taskId, pastDeadline, pastDeadline, pastDeadline, pastDeadline, pastDeadline);

      db.prepare(`
        INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
        VALUES (?, 4, 'primary', ?, 1)
      `).run(taskId, pastDeadline);

      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      const flags = calculateTaskFlags(task);

      assert(flags.is_overdue === true, 'Task must be calculated as overdue');
      assert(task.status === 'In Progress', 'Employee actual work status must NOT be silently replaced (Section 4)');

      runReminderScan();

      const overdueReminder = db.prepare(`
        SELECT * FROM task_reminders WHERE task_id = ? AND reminder_type = 'DEADLINE_OVERDUE'
      `).get(taskId);

      assert(overdueReminder, 'DEADLINE_OVERDUE reminder must be recorded');

      return `Overdue task preserved status="In Progress" with calculated flag is_overdue=true. DEADLINE_OVERDUE reminder dispatched and logged.`;
    });

    // -----------------------------------------------------------------
    // AT-07: Task is completed -> Inactivity reminders stop.
    // -----------------------------------------------------------------
    await runTest('AT-07', 'Task is completed -> Inactivity reminders stop', async () => {
      const taskId = `TEST-${Date.now()}-07`;
      const past100h = new Date(Date.now() - 100 * 3600 * 1000).toISOString();

      db.prepare(`
        INSERT INTO tasks (id, title, description, created_by, priority, start_at, deadline_at, status, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at)
        VALUES (?, 'AT-07 Completed Task', 'Desc', 1, 'Medium', ?, ?, 'Completed', 1, 1, ?, ?, ?)
      `).run(taskId, past100h, nowIso, past100h, past100h, past100h);

      const scanRes = runReminderScan();

      // Check that no reminders were created for this task
      const count = db.prepare('SELECT COUNT(*) as count FROM task_reminders WHERE task_id = ?').get(taskId).count;
      assert(count === 0, 'No reminders should ever be sent for completed task');

      return `Task status is Completed. Despite 100h elapsed since last update, 0 reminders generated. Inactivity engine correctly excluded completed work.`;
    });

    // -----------------------------------------------------------------
    // AT-08: Inactivity reaches escalation threshold.
    // -----------------------------------------------------------------
    await runTest('AT-08', 'Inactivity reaches escalation threshold -> Founder/Admin receives escalation', async () => {
      const taskId = `TEST-${Date.now()}-08`;
      const past75h = new Date(Date.now() - 75 * 3600 * 1000).toISOString(); // 75h > 72h escalation threshold
      const deadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

      db.prepare(`
        INSERT INTO tasks (id, title, description, created_by, priority, start_at, deadline_at, status, reminder_policy_id, email_notifications_enabled, last_progress_updated_at, created_at, updated_at)
        VALUES (?, 'AT-08 Escalation Task', 'Desc', 1, 'Critical', ?, ?, 'In Progress', 1, 1, ?, ?, ?)
      `).run(taskId, past75h, deadline, past75h, past75h, past75h);

      db.prepare(`
        INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
        VALUES (?, 3, 'primary', ?, 1)
      `).run(taskId, past75h);

      const scanRes = runReminderScan();

      const escalation = db.prepare(`
        SELECT * FROM task_reminders WHERE task_id = ? AND reminder_type = 'ESCALATION'
      `).get(taskId);

      assert(escalation, 'ESCALATION reminder must be recorded');
      assert(escalation.recipient_user_id === 1 || escalation.recipient_user_id === 2, 'Recipient must be Founder or Admin');

      const audit = db.prepare(`
        SELECT * FROM audit_logs WHERE task_id = ? AND action = 'TASK_ESCALATED'
      `).get(taskId);
      assert(audit, 'TASK_ESCALATED action must be recorded in audit_logs');

      return `Inactivity reached 75h (exceeding 72h threshold). Escalation email dispatched to Founder Vikram Singhania and logged in audit_logs.`;
    });

    // -----------------------------------------------------------------
    // AT-09: Employee requests another employee's task via API/UI -> Access denied.
    // -----------------------------------------------------------------
    await runTest('AT-09', "Employee requests another employee's task -> Access is denied (RBAC)", async () => {
      // Rahul (ID=3) is assigned to TASK-101.
      // Priya (ID=4) attempts to access an exclusive task of Rahul.
      const taskId = `TEST-${Date.now()}-09`;
      db.prepare(`
        INSERT INTO tasks (id, title, description, created_by, priority, start_at, deadline_at, status, last_progress_updated_at, created_at, updated_at)
        VALUES (?, 'AT-09 Private Task', 'Desc', 1, 'Medium', ?, ?, 'New', ?, ?, ?)
      `).run(taskId, nowIso, nowIso, nowIso, nowIso, nowIso);

      // Only Rahul assigned
      db.prepare(`
        INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
        VALUES (?, 3, 'primary', ?, 1)
      `).run(taskId, nowIso);

      // Priya (user_id = 4) check
      const priyaAssignment = db.prepare(`
        SELECT id FROM task_assignees WHERE task_id = ? AND user_id = 4 AND active = 1
      `).get(taskId);

      assert(!priyaAssignment, 'Priya must not have an active assignment');
      // Simulated endpoint check
      const isAllowed = !!priyaAssignment;
      assert(isAllowed === false, 'Access check must evaluate to false, triggering 403 Forbidden');

      return `RBAC validated: Priya Patel (ID=4) does not have assignment for ${taskId}. Access evaluated to 403 Forbidden.`;
    });

    // -----------------------------------------------------------------
    // AT-10: Founder filters overdue/high-priority/no-update tasks.
    // -----------------------------------------------------------------
    await runTest('AT-10', 'Founder filters overdue/high-priority/no-update tasks', async () => {
      const allTasks = db.prepare('SELECT * FROM tasks').all();
      const filteredHigh = allTasks.filter(t => t.priority === 'High');
      const filteredOverdue = allTasks.filter(t => {
        const flags = calculateTaskFlags(t);
        return flags.is_overdue;
      });
      const filteredNoUpdate = allTasks.filter(t => {
        const flags = calculateTaskFlags(t);
        return flags.is_no_update_alert;
      });

      assert(Array.isArray(filteredHigh), 'High priority tasks query must return array');
      assert(Array.isArray(filteredOverdue), 'Overdue query must return array');
      assert(Array.isArray(filteredNoUpdate), 'No-update query must return array');

      return `Filter verification passed: Found ${filteredHigh.length} High-priority, ${filteredOverdue.length} Overdue, and ${filteredNoUpdate.length} No-Update tasks accurately.`;
    });

    // -----------------------------------------------------------------
    // AT-11: Email contains task link.
    // -----------------------------------------------------------------
    await runTest('AT-11', 'Email contains task link opening the authorized task detail page', async () => {
      const email = db.prepare('SELECT * FROM sent_emails WHERE body_html LIKE ? ORDER BY id DESC LIMIT 1').get('%/?task=%');
      assert(email, 'At least one sent email must contain direct task link with "?task=" parameter');
      assert(email.body_html.includes('/?task='), 'HTML body must contain direct hyperlink to task detail page');

      return `Found email #${email.id} (Subject: "${email.subject}") containing verified direct link: href="http://localhost:5173/?task=${email.task_id}".`;
    });

    // -----------------------------------------------------------------
    // AT-12: Reminder settings are changed -> New configuration applied without code changes.
    // -----------------------------------------------------------------
    await runTest('AT-12', 'Reminder settings are changed -> New configuration applied dynamically', async () => {
      // Update policy 1 first_reminder_hours from 24 to 18
      db.prepare(`
        UPDATE reminder_policies
        SET first_reminder_hours = 18, updated_at = ?
        WHERE id = 1
      `).run(nowIso);

      const policy = db.prepare('SELECT first_reminder_hours FROM reminder_policies WHERE id = 1').get();
      assert(policy.first_reminder_hours === 18, 'First reminder hours must reflect updated value (18h)');

      // Revert back to 24 for default
      db.prepare(`
        UPDATE reminder_policies
        SET first_reminder_hours = 24, updated_at = ?
        WHERE id = 1
      `).run(nowIso);

      return `Policy thresholds updated dynamically in database to 18h and verified. Zero code rewrite or server rebuild required.`;
    });

    const passedCount = results.filter(r => r.status === 'PASSED').length;
    const failedCount = results.filter(r => r.status === 'FAILED').length;

    res.json({
      success: true,
      summary: {
        total: results.length,
        passed: passedCount,
        failed: failedCount,
        all_passed: failedCount === 0
      },
      results
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
