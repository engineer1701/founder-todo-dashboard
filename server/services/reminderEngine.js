const { db, getEffectiveNow, getEffectiveNowISO } = require('../db/database');
const { sendEmail } = require('./emailService');
const { logAudit } = require('./auditService');

/**
 * Checks whether a reminder of given type has already been sent for this task
 * since the last status/progress update (inactivity cycle idempotency).
 */
function hasReminderBeenSentSince(taskId, reminderType, sinceIsoString) {
  const existing = db.prepare(`
    SELECT COUNT(*) as count FROM task_reminders
    WHERE task_id = ? AND reminder_type = ? AND (sent_at >= ? OR scheduled_at >= ?)
  `).get(taskId, reminderType, sinceIsoString, sinceIsoString);
  return existing && existing.count > 0;
}

/**
 * Checks whether a deadline reminder (approaching or overdue) was already sent for this task.
 */
function hasTaskReminderType(taskId, reminderType) {
  const existing = db.prepare(`
    SELECT COUNT(*) as count FROM task_reminders
    WHERE task_id = ? AND reminder_type = ?
  `).get(taskId, reminderType);
  return existing && existing.count > 0;
}

/**
 * Calculates real-time computed flags for a task without mutating base status.
 */
function calculateTaskFlags(task, effectiveNow = null) {
  const now = effectiveNow || getEffectiveNow();
  const deadline = new Date(task.deadline_at);
  const lastProgress = new Date(task.last_progress_updated_at || task.created_at);

  const isTerminal = ['Completed', 'Approved', 'Cancelled'].includes(task.status);
  const isOverdue = !isTerminal && now.getTime() > deadline.getTime();

  const hoursInactive = Math.max(0, (now.getTime() - lastProgress.getTime()) / (1000 * 3600));

  // Determine policy thresholds (fallback to standard if missing)
  const firstThreshold = task.first_reminder_hours !== undefined ? task.first_reminder_hours : 24;
  const secondThreshold = task.second_reminder_hours !== undefined ? task.second_reminder_hours : 48;
  const escalationThreshold = task.escalation_hours !== undefined ? task.escalation_hours : 72;

  const isNoUpdateAlert = !isTerminal && hoursInactive >= firstThreshold;

  // Determine current reminder stage in this update cycle
  const sinceIso = task.last_progress_updated_at;
  const hasEscalated = hasReminderBeenSentSince(task.id, 'ESCALATION', sinceIso);
  const hasSecond = hasReminderBeenSentSince(task.id, 'SECOND_REMINDER', sinceIso);
  const hasFirst = hasReminderBeenSentSince(task.id, 'FIRST_REMINDER', sinceIso);

  let reminderStage = 'None';
  if (hasEscalated) {
    reminderStage = 'Escalated to Management';
  } else if (hasSecond) {
    reminderStage = '2nd Reminder Sent';
  } else if (hasFirst) {
    reminderStage = '1st Reminder Sent';
  } else if (isNoUpdateAlert) {
    reminderStage = 'Threshold Reached (Pending Scheduler)';
  }

  // Calculate deadline urgency
  const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 3600);
  let deadlineCategory = 'Upcoming';
  if (isOverdue) {
    deadlineCategory = 'Overdue';
  } else if (hoursUntilDeadline <= 24 && hoursUntilDeadline >= 0) {
    deadlineCategory = 'Due Today / Tomorrow';
  }

  return {
    is_overdue: isOverdue,
    hours_inactive: parseFloat(hoursInactive.toFixed(1)),
    is_no_update_alert: isNoUpdateAlert,
    reminder_stage: reminderStage,
    deadline_category: deadlineCategory,
    hours_until_deadline: parseFloat(hoursUntilDeadline.toFixed(1))
  };
}

/**
 * Core Reminder Engine Execution Pass
 * Designed according to Section 9 & 10 Specifications.
 */
function runReminderScan() {
  const effectiveNow = getEffectiveNow();
  const nowIso = effectiveNow.toISOString();

  // 1. Select active, non-cancelled tasks joined with policy & creator
  const activeTasks = db.prepare(`
    SELECT t.*, 
           rp.name as policy_name, rp.enabled as policy_enabled,
           rp.first_reminder_hours, rp.second_reminder_hours, rp.escalation_hours, rp.deadline_reminder_hours,
           u.name as creator_name, u.email as creator_email
    FROM tasks t
    LEFT JOIN reminder_policies rp ON t.reminder_policy_id = rp.id
    LEFT JOIN users u ON t.created_by = u.id
    WHERE t.status NOT IN ('Completed', 'Approved', 'Cancelled')
  `).all();

  const report = {
    executedAt: nowIso,
    tasksScanned: activeTasks.length,
    remindersSent: 0,
    escalationsSent: 0,
    skippedDuplicates: 0,
    actions: []
  };

  // Find Founder & Admins for escalation
  const founderAdmins = db.prepare(`
    SELECT id, name, email FROM users WHERE role IN ('founder', 'admin') AND status = 'active'
  `).all();

  for (const task of activeTasks) {
    // If task-level or policy-level notifications are disabled, skip
    if (task.email_notifications_enabled === 0 || (task.policy_enabled !== null && task.policy_enabled === 0)) {
      continue;
    }

    const firstHours = task.first_reminder_hours || 24;
    const secondHours = task.second_reminder_hours || 48;
    const escalationHours = task.escalation_hours || 72;
    const deadlineHours = task.deadline_reminder_hours || 12;

    const lastProgress = new Date(task.last_progress_updated_at || task.created_at);
    const deadline = new Date(task.deadline_at);

    const hoursInactive = (effectiveNow.getTime() - lastProgress.getTime()) / (1000 * 3600);
    const hoursUntilDeadline = (deadline.getTime() - effectiveNow.getTime()) / (1000 * 3600);

    // Fetch primary and assigned users
    const assignees = db.prepare(`
      SELECT u.id, u.name, u.email, ta.responsibility_type
      FROM task_assignees ta
      JOIN users u ON ta.user_id = u.id
      WHERE ta.task_id = ? AND ta.active = 1
    `).all(task.id);

    const primaryAssignee = assignees.find(a => a.responsibility_type === 'primary') || assignees[0];

    // Common template variables
    const templateVars = {
      task_id: task.id,
      taskId: task.id,
      task_title: task.title,
      description: task.description || 'No description provided.',
      assignee_name: primaryAssignee ? primaryAssignee.name : 'Unassigned',
      creator_name: task.creator_name || 'Founder',
      priority: task.priority,
      status: task.status,
      progress_pct: task.progress_pct || 0,
      deadline: new Date(task.deadline_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      hours_inactive: Math.floor(hoursInactive),
      hours_remaining: Math.max(0, Math.round(hoursUntilDeadline))
    };

    // -------------------------------------------------------------
    // RULE A: Inactivity Escalation (Threshold 3: Escalation Hours)
    // -------------------------------------------------------------
    if (hoursInactive >= escalationHours) {
      const alreadyEscalated = hasReminderBeenSentSince(task.id, 'ESCALATION', task.last_progress_updated_at);
      if (!alreadyEscalated) {
        // Send escalation to Founder/Admin
        for (const admin of founderAdmins) {
          sendEmail({
            taskId: task.id,
            recipientEmail: admin.email,
            recipientName: admin.name,
            recipientUserId: admin.id,
            eventType: 'Task Escalated',
            templateKey: 'TASK_ESCALATED',
            variables: { ...templateVars, recipient_name: admin.name }
          });

          db.prepare(`
            INSERT INTO task_reminders (task_id, recipient_user_id, reminder_type, scheduled_at, sent_at, status, attempt_count, cycle_id, metadata)
            VALUES (?, ?, 'ESCALATION', ?, ?, 'sent', 1, ?, ?)
          `).run(
            task.id,
            admin.id,
            nowIso,
            nowIso,
            task.last_progress_updated_at,
            JSON.stringify({ hoursInactive, escalatedTo: admin.email })
          );
        }

        logAudit(task.id, null, 'TASK_ESCALATED', {
          hoursInactive,
          escalatedTo: founderAdmins.map(a => a.email)
        });

        report.escalationsSent++;
        report.actions.push({
          taskId: task.id,
          type: 'ESCALATION',
          reason: `No update for ${hoursInactive.toFixed(1)}h (Threshold: ${escalationHours}h)`
        });
      } else {
        report.skippedDuplicates++;
      }
    }
    // -------------------------------------------------------------
    // RULE B: Second Inactivity Reminder (Threshold 2: Second Reminder Hours)
    // -------------------------------------------------------------
    else if (hoursInactive >= secondHours) {
      const alreadySentSecond = hasReminderBeenSentSince(task.id, 'SECOND_REMINDER', task.last_progress_updated_at);
      if (!alreadySentSecond) {
        if (primaryAssignee) {
          sendEmail({
            taskId: task.id,
            recipientEmail: primaryAssignee.email,
            recipientName: primaryAssignee.name,
            recipientUserId: primaryAssignee.id,
            eventType: 'Second Reminder',
            templateKey: 'SECOND_REMINDER',
            variables: templateVars
          });

          db.prepare(`
            INSERT INTO task_reminders (task_id, recipient_user_id, reminder_type, scheduled_at, sent_at, status, attempt_count, cycle_id, metadata)
            VALUES (?, ?, 'SECOND_REMINDER', ?, ?, 'sent', 1, ?, ?)
          `).run(
            task.id,
            primaryAssignee.id,
            nowIso,
            nowIso,
            task.last_progress_updated_at,
            JSON.stringify({ hoursInactive })
          );

          logAudit(task.id, primaryAssignee.id, 'SECOND_REMINDER_SENT', { hoursInactive });

          report.remindersSent++;
          report.actions.push({
            taskId: task.id,
            type: 'SECOND_REMINDER',
            recipient: primaryAssignee.email,
            reason: `No update for ${hoursInactive.toFixed(1)}h (Threshold: ${secondHours}h)`
          });
        }
      } else {
        report.skippedDuplicates++;
      }
    }
    // -------------------------------------------------------------
    // RULE C: First Inactivity Reminder (Threshold 1: First Reminder Hours)
    // -------------------------------------------------------------
    else if (hoursInactive >= firstHours) {
      const alreadySentFirst = hasReminderBeenSentSince(task.id, 'FIRST_REMINDER', task.last_progress_updated_at);
      if (!alreadySentFirst) {
        if (primaryAssignee) {
          sendEmail({
            taskId: task.id,
            recipientEmail: primaryAssignee.email,
            recipientName: primaryAssignee.name,
            recipientUserId: primaryAssignee.id,
            eventType: 'Status Update Reminder',
            templateKey: 'STATUS_UPDATE_REMINDER',
            variables: templateVars
          });

          db.prepare(`
            INSERT INTO task_reminders (task_id, recipient_user_id, reminder_type, scheduled_at, sent_at, status, attempt_count, cycle_id, metadata)
            VALUES (?, ?, 'FIRST_REMINDER', ?, ?, 'sent', 1, ?, ?)
          `).run(
            task.id,
            primaryAssignee.id,
            nowIso,
            nowIso,
            task.last_progress_updated_at,
            JSON.stringify({ hoursInactive })
          );

          logAudit(task.id, primaryAssignee.id, 'FIRST_REMINDER_SENT', { hoursInactive });

          report.remindersSent++;
          report.actions.push({
            taskId: task.id,
            type: 'FIRST_REMINDER',
            recipient: primaryAssignee.email,
            reason: `No update for ${hoursInactive.toFixed(1)}h (Threshold: ${firstHours}h)`
          });
        }
      } else {
        report.skippedDuplicates++;
      }
    }

    // -------------------------------------------------------------
    // RULE D: Approaching Deadline Reminder
    // -------------------------------------------------------------
    if (hoursUntilDeadline > 0 && hoursUntilDeadline <= deadlineHours) {
      const alreadySentApproaching = hasTaskReminderType(task.id, 'DEADLINE_APPROACHING');
      if (!alreadySentApproaching && primaryAssignee) {
        sendEmail({
          taskId: task.id,
          recipientEmail: primaryAssignee.email,
          recipientName: primaryAssignee.name,
          recipientUserId: primaryAssignee.id,
          eventType: 'Deadline Approaching',
          templateKey: 'DEADLINE_APPROACHING',
          variables: templateVars
        });

        db.prepare(`
          INSERT INTO task_reminders (task_id, recipient_user_id, reminder_type, scheduled_at, sent_at, status, attempt_count, cycle_id, metadata)
          VALUES (?, ?, 'DEADLINE_APPROACHING', ?, ?, 'sent', 1, 'deadline', ?)
        `).run(task.id, primaryAssignee.id, nowIso, nowIso, JSON.stringify({ hoursUntilDeadline }));

        logAudit(task.id, primaryAssignee.id, 'DEADLINE_APPROACHING_SENT', { hoursUntilDeadline });
        report.remindersSent++;
        report.actions.push({
          taskId: task.id,
          type: 'DEADLINE_APPROACHING',
          recipient: primaryAssignee.email
        });
      }
    }

    // -------------------------------------------------------------
    // RULE E: Overdue Deadline Reminder
    // -------------------------------------------------------------
    if (hoursUntilDeadline <= 0) {
      const alreadySentOverdue = hasTaskReminderType(task.id, 'DEADLINE_OVERDUE');
      if (!alreadySentOverdue && primaryAssignee) {
        sendEmail({
          taskId: task.id,
          recipientEmail: primaryAssignee.email,
          recipientName: primaryAssignee.name,
          recipientUserId: primaryAssignee.id,
          eventType: 'Overdue',
          templateKey: 'OVERDUE',
          variables: templateVars
        });

        db.prepare(`
          INSERT INTO task_reminders (task_id, recipient_user_id, reminder_type, scheduled_at, sent_at, status, attempt_count, cycle_id, metadata)
          VALUES (?, ?, 'DEADLINE_OVERDUE', ?, ?, 'sent', 1, 'overdue', ?)
        `).run(task.id, primaryAssignee.id, nowIso, nowIso, JSON.stringify({ hoursOverdue: Math.abs(hoursUntilDeadline) }));

        logAudit(task.id, primaryAssignee.id, 'DEADLINE_OVERDUE_SENT', { hoursOverdue: Math.abs(hoursUntilDeadline) });
        report.remindersSent++;
        report.actions.push({
          taskId: task.id,
          type: 'DEADLINE_OVERDUE',
          recipient: primaryAssignee.email
        });
      }
    }
  }

  return report;
}

/**
 * Triggers a manual reminder for a task immediately.
 */
function sendManualReminder(taskId, actorUserId, customMessage = null) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new Error('Task not found');

  const assignees = db.prepare(`
    SELECT u.id, u.name, u.email, ta.responsibility_type
    FROM task_assignees ta
    JOIN users u ON ta.user_id = u.id
    WHERE ta.task_id = ? AND ta.active = 1
  `).all(taskId);

  if (assignees.length === 0) {
    throw new Error('Task has no active assignees to remind');
  }

  const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(actorUserId) || { name: 'Management' };
  const nowIso = getEffectiveNowISO();

  const results = [];

  for (const assignee of assignees) {
    const res = sendEmail({
      taskId: task.id,
      recipientEmail: assignee.email,
      recipientName: assignee.name,
      recipientUserId: assignee.id,
      eventType: 'Status Update Reminder',
      templateKey: 'STATUS_UPDATE_REMINDER',
      variables: {
        task_id: task.id,
        taskId: task.id,
        task_title: task.title,
        description: task.description || '',
        assignee_name: assignee.name,
        creator_name: actor.name,
        priority: task.priority,
        status: task.status,
        deadline: new Date(task.deadline_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        hours_inactive: 'Manual nudge'
      }
    });

    db.prepare(`
      INSERT INTO task_reminders (task_id, recipient_user_id, reminder_type, scheduled_at, sent_at, status, attempt_count, cycle_id, metadata)
      VALUES (?, ?, 'MANUAL_REMINDER', ?, ?, 'sent', 1, 'manual', ?)
    `).run(task.id, assignee.id, nowIso, nowIso, JSON.stringify({ triggeredBy: actor.name, customMessage }));

    results.push(res);
  }

  logAudit(taskId, actorUserId, 'MANUAL_REMINDER_TRIGGERED', {
    remindedUsers: assignees.map(a => a.email),
    customMessage
  });

  return results;
}

module.exports = {
  calculateTaskFlags,
  runReminderScan,
  sendManualReminder,
  hasReminderBeenSentSince,
  hasTaskReminderType
};
