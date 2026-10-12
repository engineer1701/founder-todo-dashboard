const { db, getEffectiveNow, getEffectiveNowISO } = require('../db/database');
const { sendEmail } = require('./emailService');
const { logAudit } = require('./auditService');

const HOUR_MS = 1000 * 3600;

function getBusinessHoursConfig() {
  const rows = db.prepare(`
    SELECT key, value FROM system_config
    WHERE key IN ('business_timezone', 'working_hours_start', 'working_hours_end')
  `).all();

  const config = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const businessTimezone = config.business_timezone || 'Asia/Kolkata';
  const startParts = String(config.working_hours_start || '09:30').split(':');
  const endParts = String(config.working_hours_end || '18:30').split(':');

  return {
    timeZone: businessTimezone,
    startMinutes: (Number(startParts[0]) || 0) * 60 + (Number(startParts[1]) || 0),
    endMinutes: (Number(endParts[0]) || 0) * 60 + (Number(endParts[1]) || 0)
  };
}

function isWithinBusinessHours(date, config = getBusinessHoursConfig()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const timeMap = Object.fromEntries(parts.filter(p => p.type !== 'literal').map((part) => [part.type, part.value]));
  const weekday = timeMap.weekday;
  const hour = Number(timeMap.hour || 0);
  const minute = Number(timeMap.minute || 0);
  const minutes = hour * 60 + minute;

  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return minutes >= config.startMinutes && minutes < config.endMinutes;
}

function getBusinessHoursBetween(startDate, endDate, config = getBusinessHoursConfig()) {
  if (!startDate || !endDate || endDate <= startDate) return 0;

  const rawHours = (endDate.getTime() - startDate.getTime()) / HOUR_MS;
  let cursor = new Date(startDate.getTime());
  let elapsedMinutes = 0;

  while (cursor < endDate) {
    if (isWithinBusinessHours(cursor, config)) {
      elapsedMinutes += 1;
    }
    cursor = new Date(cursor.getTime() + 60000);
  }

  const businessHours = elapsedMinutes / 60;
  if (rawHours >= 24) return rawHours;
  if (businessHours <= 0 && rawHours > 0) return rawHours;
  return businessHours;
}

/**
 * Returns the start of the current inactivity cycle for a task.
 * FIX: the old code passed task.last_progress_updated_at directly, which can be
 * NULL for a task that was never updated. "sent_at >= NULL" never matches in SQL,
 * so duplicate reminders could be sent on every scan. Fall back to created_at.
 */
function getCycleStart(task) {
  return task.last_progress_updated_at || task.created_at;
}

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
 * Returns the time of the most recent reminder of this type in the current
 * inactivity cycle, or null if none was sent. Used for the repeat_enabled rule.
 */
function getLastReminderSentAt(taskId, reminderType, sinceIsoString) {
  const row = db.prepare(`
    SELECT MAX(COALESCE(sent_at, scheduled_at)) AS last_at FROM task_reminders
    WHERE task_id = ? AND reminder_type = ? AND (sent_at >= ? OR scheduled_at >= ?)
  `).get(taskId, reminderType, sinceIsoString, sinceIsoString);
  return row && row.last_at ? new Date(row.last_at) : null;
}

/**
 * Checks whether a deadline reminder (approaching or overdue) was already sent for this task.
 * Kept for backward compatibility with any other file that imports it.
 */
function hasTaskReminderType(taskId, reminderType) {
  const existing = db.prepare(`
    SELECT COUNT(*) as count FROM task_reminders
    WHERE task_id = ? AND reminder_type = ?
  `).get(taskId, reminderType);
  return existing && existing.count > 0;
}

/**
 * FIX (#11): deadline alerts are de-duplicated per task + type + the deadline
 * value in effect. The deadline value is stored in task_reminders.cycle_id.
 * Same deadline => never alerts twice. Changed deadline => a new alert is allowed.
 */
function hasDeadlineReminderForDeadline(taskId, reminderType, deadlineAt) {
  const existing = db.prepare(`
    SELECT COUNT(*) as count FROM task_reminders
    WHERE task_id = ? AND reminder_type = ? AND cycle_id = ?
  `).get(taskId, reminderType, String(deadlineAt));
  return existing && existing.count > 0;
}

/**
 * Reads the reminder policy numbers from a task row.
 * FIX (#10): uses ?? instead of ||, so a configured 0 is kept and only
 * null/undefined (no policy, or missing value) falls back to the default.
 */
function getPolicyThresholds(task) {
  return {
    firstHours: task.first_reminder_hours ?? 24,
    secondHours: task.second_reminder_hours ?? 48,
    escalationHours: task.escalation_hours ?? 72,
    deadlineHours: task.deadline_reminder_hours ?? 12
  };
}

/**
 * FIX (#10): repeat_enabled from the reminder policy.
 * 1/true => reminders may repeat. 0/false/null (no policy) => each stage fires once per cycle.
 */
function isRepeatEnabled(task) {
  return Number(task.repeat_enabled) === 1 || task.repeat_enabled === true;
}

/**
 * Decides whether an inactivity reminder of this type should be sent now.
 * - Nothing sent yet in this cycle  => send.
 * - Already sent and repeat off     => do not send (once per cycle).
 * - Already sent and repeat on      => send again only after the repeat interval.
 */
function shouldSendInactivityReminder(task, reminderType, cycleStart, now, repeatEnabled, repeatIntervalHours) {
  const last = getLastReminderSentAt(task.id, reminderType, cycleStart);
  if (!last) return true;
  if (!repeatEnabled) return false;
  return (now.getTime() - last.getTime()) / HOUR_MS >= repeatIntervalHours;
}

/**
 * Calculates real-time computed flags for a task without mutating base status.
 */
function calculateTaskFlags(task, effectiveNow = null) {
  const now = effectiveNow || getEffectiveNow();
  const deadline = new Date(task.deadline_at);
  const cycleStart = getCycleStart(task);
  const lastProgress = new Date(cycleStart);

  const isTerminal = ['Completed', 'Approved', 'Cancelled'].includes(task.status);
  const isOverdue = !isTerminal && now.getTime() > deadline.getTime();

  const hoursInactive = Math.max(0, getBusinessHoursBetween(lastProgress, now));

  // Policy thresholds (default only when null/undefined; 0 is respected)
  const { firstHours: firstThreshold } = getPolicyThresholds(task);

  const isNoUpdateAlert = !isTerminal && hoursInactive >= firstThreshold;

  // Determine current reminder stage in this update cycle
  const hasEscalated = hasReminderBeenSentSince(task.id, 'ESCALATION', cycleStart);
  const hasSecond = hasReminderBeenSentSince(task.id, 'SECOND_REMINDER', cycleStart);
  const hasFirst = hasReminderBeenSentSince(task.id, 'FIRST_REMINDER', cycleStart);

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

  // Calculate deadline urgency in configured business hours
  const hoursUntilDeadline = Math.max(0, getBusinessHoursBetween(now, deadline));
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
           rp.repeat_enabled,
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

    // FIX (#10): zero thresholds are honored
    const { firstHours, secondHours, escalationHours, deadlineHours } = getPolicyThresholds(task);

    // FIX (#10): repeat_enabled. When repeating, resend after the first-reminder
    // interval (never shorter than 1 hour, so a 0 threshold cannot spam every scan).
    const repeatEnabled = isRepeatEnabled(task);
    const repeatIntervalHours = Math.max(firstHours, 1);

    // FIX: never NULL, so duplicate checks always work
    const cycleStart = getCycleStart(task);

    const lastProgress = new Date(cycleStart);
    const deadline = new Date(task.deadline_at);

    const hoursInactive = getBusinessHoursBetween(lastProgress, effectiveNow);
    const hoursUntilDeadline = Math.max(0, getBusinessHoursBetween(effectiveNow, deadline));

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
      const sendEscalation = shouldSendInactivityReminder(
        task, 'ESCALATION', cycleStart, effectiveNow, repeatEnabled, repeatIntervalHours
      );
      if (sendEscalation) {
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
            cycleStart,
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
      const sendSecond = shouldSendInactivityReminder(
        task, 'SECOND_REMINDER', cycleStart, effectiveNow, repeatEnabled, repeatIntervalHours
      );
      if (sendSecond) {
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
            cycleStart,
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
      const sendFirst = shouldSendInactivityReminder(
        task, 'FIRST_REMINDER', cycleStart, effectiveNow, repeatEnabled, repeatIntervalHours
      );
      if (sendFirst) {
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
            cycleStart,
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
    // FIX (#11): de-duplicated per task + type + current deadline value
    // -------------------------------------------------------------
    if (hoursUntilDeadline > 0 && hoursUntilDeadline <= deadlineHours) {
      const alreadySentApproaching = hasDeadlineReminderForDeadline(task.id, 'DEADLINE_APPROACHING', task.deadline_at);
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
          VALUES (?, ?, 'DEADLINE_APPROACHING', ?, ?, 'sent', 1, ?, ?)
        `).run(
          task.id,
          primaryAssignee.id,
          nowIso,
          nowIso,
          String(task.deadline_at),
          JSON.stringify({ hoursUntilDeadline, deadlineAt: task.deadline_at })
        );

        logAudit(task.id, primaryAssignee.id, 'DEADLINE_APPROACHING_SENT', { hoursUntilDeadline });
        report.remindersSent++;
        report.actions.push({
          taskId: task.id,
          type: 'DEADLINE_APPROACHING',
          recipient: primaryAssignee.email
        });
      } else if (alreadySentApproaching) {
        report.skippedDuplicates++;
      }
    }

    // -------------------------------------------------------------
    // RULE E: Deadline Reached (sent once per task+deadline value)
    // -------------------------------------------------------------
    if (hoursUntilDeadline <= 0) {
      const alreadySentReached = hasDeadlineReminderForDeadline(task.id, 'DEADLINE_REACHED', task.deadline_at);
      if (!alreadySentReached && primaryAssignee) {
        sendEmail({
          taskId: task.id,
          recipientEmail: primaryAssignee.email,
          recipientName: primaryAssignee.name,
          recipientUserId: primaryAssignee.id,
          eventType: 'Deadline Reached',
          templateKey: 'DEADLINE_REACHED',
          variables: templateVars
        });

        db.prepare(`
          INSERT INTO task_reminders (task_id, recipient_user_id, reminder_type, scheduled_at, sent_at, status, attempt_count, cycle_id, metadata)
          VALUES (?, ?, 'DEADLINE_REACHED', ?, ?, 'sent', 1, ?, ?)
        `).run(
          task.id,
          primaryAssignee.id,
          nowIso,
          nowIso,
          String(task.deadline_at),
          JSON.stringify({ deadlineAt: task.deadline_at })
        );

        logAudit(task.id, primaryAssignee.id, 'DEADLINE_REACHED_SENT', { deadlineAt: task.deadline_at });
        report.remindersSent++;
        report.actions.push({
          taskId: task.id,
          type: 'DEADLINE_REACHED',
          recipient: primaryAssignee.email
        });
      } else if (alreadySentReached) {
        report.skippedDuplicates++;
      }
    }

    // -------------------------------------------------------------
    // RULE F: Overdue Deadline Reminder
    // Send only after Deadline Reached has been logged for the current deadline.
    // FIX (#11): de-duplicated per task + type + current deadline value.
    // -------------------------------------------------------------
    if (hoursUntilDeadline <= 0 && hasDeadlineReminderForDeadline(task.id, 'DEADLINE_REACHED', task.deadline_at)) {
      const alreadySentOverdue = hasDeadlineReminderForDeadline(task.id, 'DEADLINE_OVERDUE', task.deadline_at);
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
          VALUES (?, ?, 'DEADLINE_OVERDUE', ?, ?, 'sent', 1, ?, ?)
        `).run(
          task.id,
          primaryAssignee.id,
          nowIso,
          nowIso,
          String(task.deadline_at),
          JSON.stringify({ hoursOverdue: Math.abs(hoursUntilDeadline), deadlineAt: task.deadline_at })
        );

        logAudit(task.id, primaryAssignee.id, 'DEADLINE_OVERDUE_SENT', { hoursOverdue: Math.abs(hoursUntilDeadline) });
        report.remindersSent++;
        report.actions.push({
          taskId: task.id,
          type: 'DEADLINE_OVERDUE',
          recipient: primaryAssignee.email
        });
      } else if (alreadySentOverdue) {
        report.skippedDuplicates++;
      }
    }
  }

  return report;
}

/**
 * Triggers a manual reminder for a task immediately.
 */
async function sendManualReminder(taskId, actorUserId, customMessage = null) {
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
    const res = await sendEmail({
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
  hasTaskReminderType,
  hasDeadlineReminderForDeadline
};