const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const router = express.Router();
const { db, getEffectiveNow, getEffectiveNowISO } = require('../db/database');
const { calculateTaskFlags, sendManualReminder } = require('../services/reminderEngine');
const { sendEmail } = require('../services/emailService');
const { logAudit } = require('../services/auditService');
const { ApiError } = require('../middleware/errors');
const { requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { schemas } = require('../validation');
const { getAllowedNextStatuses, isStatusTransitionAllowed } = require('../services/statusRules');

const ATTACHMENT_DIR = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(ATTACHMENT_DIR, { recursive: true });

const allowedAttachmentTypes = (process.env.ATTACHMENT_ALLOWED_TYPES || 'pdf,doc,docx,png,jpg,jpeg,txt,csv,xlsx,xls,zip')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const attachmentMimeSet = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'text/csv'
]);
const attachmentMaxBytes = Number(process.env.ATTACHMENT_MAX_SIZE_MB || 10) * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ATTACHMENT_DIR),
    filename: (_req, file, cb) => {
      const original = (file.originalname || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '_');
      const base = path.basename(original, path.extname(original)) || 'attachment';
      const ext = path.extname(original) || '';
      const safeName = `${Date.now()}-${base.slice(0, 80)}${ext}`;
      cb(null, safeName);
    }
  }),
  limits: { fileSize: attachmentMaxBytes },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');
    const mime = (file.mimetype || '').toLowerCase();
    const isAllowed = allowedAttachmentTypes.includes(ext) || attachmentMimeSet.has(mime) || allowedAttachmentTypes.includes(mime);
    if (isAllowed) {
      cb(null, true);
      return;
    }
    cb(new Error('Unsupported attachment type.'));
  }
});

const TERMINAL_STATUSES = ['Completed', 'Approved', 'Cancelled'];
const DONE_STATUSES = ['Completed', 'Approved'];

// Helper to check if user has access to task
function checkTaskAccess(taskId, user) {
  if (user.role === 'founder' || user.role === 'admin') {
    return true;
  }
  const assignment = db.prepare(`
    SELECT id FROM task_assignees 
    WHERE task_id = ? AND user_id = ? AND active = 1
  `).get(taskId, user.id);

  return !!assignment;
}

// Runs fn inside one database transaction: everything commits together or
// everything rolls back (used for create, edit, reassign and status update).
function runAtomically(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw err;
  }
}

// Emails are sent only AFTER the transaction commits, so a rolled-back change
// never produces an email. sendEmail never throws, but guard anyway.
function dispatchEmails(emails) {
  for (const email of emails) {
    Promise.resolve(sendEmail(email)).catch((err) => {
      console.error('[tasks] Email dispatch error:', err && err.message);
    });
  }
}

function formatDeadline(deadlineAt) {
  return new Date(deadlineAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// Turns assignee_ids / primary id into a clean list and checks every user exists and is active.
function buildAssigneeList(primaryId, assigneeIds) {
  const list = [];
  if (primaryId) {
    const uid = parseInt(primaryId, 10);
    if (!uid) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid primary assignee.');
    list.push({ userId: uid, responsibility: 'primary' });
  }
  if (Array.isArray(assigneeIds)) {
    for (const item of assigneeIds) {
      const uid = typeof item === 'object' && item !== null ? parseInt(item.userId, 10) : parseInt(item, 10);
      const resp = typeof item === 'object' && item !== null && item.responsibility ? item.responsibility : 'contributor';
      if (!uid) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid assignee id.');
      if (!list.some(a => a.userId === uid)) {
        list.push({ userId: uid, responsibility: resp });
      }
    }
  }
  for (const a of list) {
    const u = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(a.userId);
    if (!u) throw new ApiError(400, 'VALIDATION_ERROR', `User ${a.userId} does not exist or is not active.`);
  }
  return list;
}

// Builds "Task Reopened" emails for a task that moved from Completed/Approved back to active.
// Recipients: active assignees and the task creator, except the person who made the change.
function buildReopenEmails(task, newStatus, actor, remark) {
  const recipients = db.prepare(`
    SELECT u.id, u.name, u.email
    FROM task_assignees ta
    JOIN users u ON ta.user_id = u.id
    WHERE ta.task_id = ? AND ta.active = 1
  `).all(task.id);

  const creator = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(task.created_by);
  if (creator && !recipients.some(r => r.id === creator.id)) recipients.push(creator);

  return recipients
    .filter(r => r.id !== actor.id)
    .map(r => ({
      taskId: task.id,
      recipientEmail: r.email,
      recipientName: r.name,
      recipientUserId: r.id,
      eventType: 'Task Reopened',
      templateKey: 'TASK_REOPENED',
      variables: {
        task_id: task.id,
        taskId: task.id,
        task_title: task.title,
        assignee_name: r.name,
        recipient_name: r.name,
        creator_name: actor.name,
        status: newStatus,
        priority: task.priority,
        deadline: formatDeadline(task.deadline_at),
        remark: remark || ''
      }
    }));
}

// -------------------------------------------------------------
// GET /api/tasks - List & filter tasks (Section 8)
// -------------------------------------------------------------
router.get('/', (req, res, next) => {
  try {
    const user = req.user;
    const {
      status,
      priority,
      assignee_id,
      department_id,
      search,
      is_overdue,
      no_update_only,
      my_tasks_only,
      tab, // 'new', 'active', 'due_today', 'upcoming', 'overdue', 'completed'
      sort_by = 'created_at',
      sort_dir = 'DESC',
      limit,
      page
    } = req.query;

    const requestedPage = parseInt(page, 10);
    const requestedLimit = parseInt(limit, 10);
    const safePage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const safeLimit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 10;

    const effectiveNow = getEffectiveNow();

    let query = `
      SELECT t.*,
             rp.name as policy_name, rp.first_reminder_hours, rp.second_reminder_hours, rp.escalation_hours, rp.deadline_reminder_hours,
             u.name as creator_name, u.email as creator_email
      FROM tasks t
      LEFT JOIN reminder_policies rp ON t.reminder_policy_id = rp.id
      LEFT JOIN users u ON t.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    // RBAC: If employee, restricted to own tasks only (US-03, AT-09)
    if (user.role === 'employee' || my_tasks_only === 'true') {
      query += ` AND t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ? AND active = 1) `;
      params.push(user.id);
    } else if (assignee_id) {
      query += ` AND t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ? AND active = 1) `;
      params.push(parseInt(assignee_id, 10));
    }

    if (department_id) {
      query += ` AND t.id IN (
        SELECT ta.task_id FROM task_assignees ta
        JOIN users u2 ON ta.user_id = u2.id
        WHERE u2.department_id = ?
      ) `;
      params.push(parseInt(department_id, 10));
    }

    if (status) {
      query += ` AND t.status = ? `;
      params.push(status);
    }

    if (priority) {
      query += ` AND t.priority = ? `;
      params.push(priority);
    }

    if (search) {
      query += ` AND (t.id LIKE ? OR t.title LIKE ? OR t.description LIKE ?) `;
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    // Sorting
    const safeSort = ['created_at', 'deadline_at', 'last_progress_updated_at', 'priority', 'status', 'title'].includes(sort_by)
      ? sort_by
      : 'created_at';
    const safeDir = sort_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY t.${safeSort} ${safeDir} `;

    const rawTasks = db.prepare(query).all(...params);

    // Enrich tasks with assignees and dynamic real-time flags
    let tasks = rawTasks.map(task => {
      const assignees = db.prepare(`
        SELECT u.id, u.name, u.email, u.avatar_url, u.designation, ta.responsibility_type
        FROM task_assignees ta
        JOIN users u ON ta.user_id = u.id
        WHERE ta.task_id = ? AND ta.active = 1
      `).all(task.id);

      const flags = calculateTaskFlags(task, effectiveNow);

      return {
        ...task,
        assignees,
        primary_assignee: assignees.find(a => a.responsibility_type === 'primary') || assignees[0] || null,
        ...flags
      };
    });

    // Post-calculation filters (overdue, no-update, tab filters)
    if (is_overdue === 'true') {
      tasks = tasks.filter(t => t.is_overdue);
    }

    if (no_update_only === 'true') {
      tasks = tasks.filter(t => t.is_no_update_alert);
    }

    if (tab) {
      if (tab === 'new') {
        tasks = tasks.filter(t => t.status === 'New');
      } else if (tab === 'active') {
        tasks = tasks.filter(t => ['Acknowledged', 'In Progress', 'Awaiting Information', 'Rework Required'].includes(t.status));
      } else if (tab === 'due_today') {
        tasks = tasks.filter(t => t.hours_until_deadline >= 0 && t.hours_until_deadline <= 24 && !TERMINAL_STATUSES.includes(t.status));
      } else if (tab === 'upcoming') {
        tasks = tasks.filter(t => t.hours_until_deadline > 24 && !TERMINAL_STATUSES.includes(t.status));
      } else if (tab === 'overdue') {
        tasks = tasks.filter(t => t.is_overdue);
      } else if (tab === 'completed') {
        tasks = tasks.filter(t => DONE_STATUSES.includes(t.status));
      }
    }

    // Pagination
    const totalCount = tasks.length;
    const offset = (safePage - 1) * safeLimit;
    const paginated = tasks.slice(offset, offset + safeLimit);

    res.json({
      success: true,
      total: totalCount,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(totalCount / safeLimit) || 1,
      tasks: paginated
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// GET /api/tasks/:id - Task detail (Section 8, US-03, US-05)
// -------------------------------------------------------------
router.get('/:id', (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    const task = db.prepare(`
      SELECT t.*,
             rp.name as policy_name, rp.first_reminder_hours, rp.second_reminder_hours, rp.escalation_hours, rp.deadline_reminder_hours,
             u.name as creator_name, u.email as creator_email
      FROM tasks t
      LEFT JOIN reminder_policies rp ON t.reminder_policy_id = rp.id
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.id = ?
    `).get(taskId);

    if (!task) {
      return next(new ApiError(404, 'NOT_FOUND', 'Task not found.'));
    }

    // RBAC: Check access (AT-09)
    if (!checkTaskAccess(taskId, user)) {
      return next(new ApiError(403, 'ACCESS_DENIED', 'Access denied: You are not assigned to this task.'));
    }

    const effectiveNow = getEffectiveNow();
    const flags = calculateTaskFlags(task, effectiveNow);

    const assignees = db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar_url, u.designation, ta.responsibility_type, ta.assigned_at
      FROM task_assignees ta
      JOIN users u ON ta.user_id = u.id
      WHERE ta.task_id = ? AND ta.active = 1
    `).all(taskId);

    const updates = db.prepare(`
      SELECT tu.*, u.name as user_name, u.avatar_url
      FROM task_updates tu
      JOIN users u ON tu.user_id = u.id
      WHERE tu.task_id = ?
      ORDER BY tu.created_at DESC
    `).all(taskId);

    const comments = db.prepare(`
      SELECT tc.*, u.name as user_name, u.avatar_url, u.role
      FROM task_comments tc
      JOIN users u ON tc.user_id = u.id
      WHERE tc.task_id = ?
      ORDER BY tc.created_at ASC
    `).all(taskId);

    const reminders = db.prepare(`
      SELECT tr.*, u.name as recipient_name, u.email as recipient_email
      FROM task_reminders tr
      JOIN users u ON tr.recipient_user_id = u.id
      WHERE tr.task_id = ?
      ORDER BY tr.id DESC
    `).all(taskId);

    const attachments = db.prepare(`
      SELECT ta.*, u.name as uploader_name
      FROM task_attachments ta
      JOIN users u ON ta.uploaded_by = u.id
      WHERE ta.task_id = ?
      ORDER BY ta.created_at DESC
    `).all(taskId);

    const taskRequests = db.prepare(`
      SELECT tr.*, u.name as requested_by_name, reviewer.name as reviewed_by_name
      FROM task_requests tr
      JOIN users u ON tr.requested_by = u.id
      LEFT JOIN users reviewer ON tr.reviewed_by = reviewer.id
      WHERE tr.task_id = ?
      ORDER BY tr.created_at DESC
    `).all(taskId);

    const auditTrail = db.prepare(`
      SELECT al.*, u.name as actor_name
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_user_id = u.id
      WHERE al.task_id = ?
      ORDER BY al.id DESC
    `).all(taskId);

    res.json({
      success: true,
      task: {
        ...task,
        assignees,
        primary_assignee: assignees.find(a => a.responsibility_type === 'primary') || assignees[0] || null,
        ...flags,
        allowed_statuses: getAllowedNextStatuses(task.status, user.role),
        updates,
        comments,
        reminders,
        attachments,
        requests: taskRequests,
        auditTrail: user.role === 'employee' ? [] : auditTrail
      }
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// POST /api/tasks - Create task (Section 8, US-01, AT-01)
// -------------------------------------------------------------
router.post('/', requireRole('founder', 'admin'), validateBody(schemas.taskCreate), (req, res, next) => {
  try {
    const user = req.user;
    // Only Founder / Admin can create tasks
    if (user.role === 'employee') {
      return next(new ApiError(403, 'FORBIDDEN', 'Only Founder or Admin can create tasks.'));
    }

    const {
      title,
      description,
      instructions,
      priority = 'Medium',
      start_at,
      deadline_at,
      assignee_ids = [], // Array of user IDs or { userId, responsibility_type }
      primary_assignee_id,
      reminder_policy_id = 1,
      email_notifications_enabled = 1,
      recurrence_rule = null
    } = req.body;

    if (!title || !title.trim()) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Task title is required.'));
    }
    if (!deadline_at) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Task deadline is required.'));
    }

    const nowIso = getEffectiveNowISO();
    const emails = [];

    // Task row, assignee rows and audit entry commit together (or not at all)
    const taskId = runAtomically(() => {
      // Generate readable Task ID (TASK-101, TASK-102, ...)
      const maxRow = db.prepare(`
        SELECT id FROM tasks WHERE id LIKE 'TASK-%' ORDER BY CAST(SUBSTR(id, 6) AS INTEGER) DESC LIMIT 1
      `).get();

      let nextNumber = 101;
      if (maxRow && maxRow.id) {
        const parsed = parseInt(maxRow.id.replace('TASK-', ''), 10);
        if (!isNaN(parsed)) nextNumber = parsed + 1;
      }
      const newTaskId = `TASK-${nextNumber}`;

      const assignedList = buildAssigneeList(primary_assignee_id, assignee_ids);

      db.prepare(`
        INSERT INTO tasks (
          id, title, description, instructions, created_by, priority,
          start_at, deadline_at, status, progress_pct, recurrence_rule,
          reminder_policy_id, email_notifications_enabled,
          last_progress_updated_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New', 0, ?, ?, ?, ?, ?, ?)
      `).run(
        newTaskId,
        title.trim(),
        description || '',
        instructions || '',
        user.id,
        priority,
        start_at || nowIso,
        deadline_at,
        recurrence_rule,
        reminder_policy_id,
        email_notifications_enabled ? 1 : 0,
        nowIso,
        nowIso,
        nowIso
      );

      for (const a of assignedList) {
        db.prepare(`
          INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
          VALUES (?, ?, ?, ?, 1)
        `).run(newTaskId, a.userId, a.responsibility, nowIso);

        const assignedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(a.userId);
        if (assignedUser && email_notifications_enabled) {
          emails.push({
            taskId: newTaskId,
            recipientEmail: assignedUser.email,
            recipientName: assignedUser.name,
            recipientUserId: assignedUser.id,
            eventType: 'New Task Assigned',
            templateKey: 'NEW_TASK_ASSIGNED',
            variables: {
              task_id: newTaskId,
              taskId: newTaskId,
              task_title: title.trim(),
              description: description || 'No description provided.',
              assignee_name: assignedUser.name,
              creator_name: user.name,
              priority,
              deadline: formatDeadline(deadline_at)
            }
          });
        }
      }

      logAudit(newTaskId, user.id, 'TASK_CREATED', {
        title,
        priority,
        deadline_at,
        assignees: assignedList
      });

      return newTaskId;
    });

    dispatchEmails(emails); // AT-01: assignment emails, after commit

    res.status(201).json({
      success: true,
      taskId,
      message: 'Task created successfully'
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// PUT /api/tasks/:id - Edit task (Section 8, Founder/Admin)
// -------------------------------------------------------------
router.put('/:id', requireRole('founder', 'admin'), validateBody(schemas.taskUpdate), (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    if (user.role === 'employee') {
      return next(new ApiError(403, 'FORBIDDEN', 'Only Founder or Admin can edit core task specifications.'));
    }

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      return next(new ApiError(404, 'NOT_FOUND', 'Task not found.'));
    }

    const {
      title,
      description,
      instructions,
      priority,
      start_at,
      deadline_at,
      reminder_policy_id,
      email_notifications_enabled,
      status
    } = req.body;

    const nowIso = getEffectiveNowISO();
    const emails = [];

    runAtomically(() => {
      db.prepare(`
        UPDATE tasks
        SET title = COALESCE(?, title),
            description = COALESCE(?, description),
            instructions = COALESCE(?, instructions),
            priority = COALESCE(?, priority),
            start_at = COALESCE(?, start_at),
            deadline_at = COALESCE(?, deadline_at),
            reminder_policy_id = COALESCE(?, reminder_policy_id),
            email_notifications_enabled = COALESCE(?, email_notifications_enabled),
            status = COALESCE(?, status),
            updated_at = ?
        WHERE id = ?
      `).run(
        title !== undefined ? title.trim() : null,
        description !== undefined ? description : null,
        instructions !== undefined ? instructions : null,
        priority || null,
        start_at || null,
        deadline_at || null,
        reminder_policy_id || null,
        email_notifications_enabled !== undefined ? (email_notifications_enabled ? 1 : 0) : null,
        status || null,
        nowIso,
        taskId
      );

      // Record exactly what changed (old -> new) in the audit trail
      const after = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      const changes = {};
      for (const field of ['title', 'description', 'instructions', 'priority', 'start_at', 'deadline_at',
        'reminder_policy_id', 'email_notifications_enabled', 'status']) {
        if (task[field] !== after[field]) {
          changes[field] = { from: task[field], to: after[field] };
        }
      }
      logAudit(taskId, user.id, 'TASK_EDITED', { updatedFields: req.body, changes });

      // Completed/Approved task moved back to an active status => Task Reopened
      if (DONE_STATUSES.includes(task.status) && !TERMINAL_STATUSES.includes(after.status) && task.email_notifications_enabled) {
        logAudit(taskId, user.id, 'TASK_REOPENED', { from: task.status, to: after.status });
        emails.push(...buildReopenEmails(after, after.status, user, ''));
      }
    });

    dispatchEmails(emails);

    res.json({ success: true, message: 'Task updated successfully' });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// POST /api/tasks/:id/assign - Assign/reassign (Section 8, US-02)
// -------------------------------------------------------------
router.post('/:id/assign', requireRole('founder', 'admin'), validateBody(schemas.assign), (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    if (user.role === 'employee') {
      return next(new ApiError(403, 'FORBIDDEN', 'Only Founder or Admin can assign or reassign tasks.'));
    }

    const { assignee_ids = [], primary_user_id } = req.body;
    const nowIso = getEffectiveNowISO();

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      return next(new ApiError(404, 'NOT_FOUND', 'Task not found.'));
    }

    const emails = [];

    // Delete old rows + insert new rows + audit entry: all or nothing (#13)
    runAtomically(() => {
      const assigned = buildAssigneeList(primary_user_id, assignee_ids);
      if (assigned.length === 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'At least one assignee is required.');
      }

      const previous = db.prepare(`
        SELECT user_id, responsibility_type FROM task_assignees
        WHERE task_id = ? AND active = 1
      `).all(taskId);

      // Remove existing assignments and replace with new
      db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);

      for (const a of assigned) {
        db.prepare(`
          INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
          VALUES (?, ?, ?, ?, 1)
        `).run(taskId, a.userId, a.responsibility, nowIso);

        if (!task.email_notifications_enabled) continue;

        const before = previous.find(p => p.user_id === a.userId);
        const assignedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(a.userId);
        if (!assignedUser) continue;

        // Newly added person => "Task Reassigned".
        // Person who stays but whose role changed => "Assignment Changed".
        // Person who stays unchanged => no email.
        let eventType = null;
        let templateKey = null;
        if (!before) {
          eventType = 'Task Reassigned';
          templateKey = 'TASK_REASSIGNED';
        } else if (before.responsibility_type !== a.responsibility) {
          eventType = 'Assignment Changed';
          templateKey = 'ASSIGNMENT_CHANGED';
        }

        if (eventType) {
          emails.push({
            taskId,
            recipientEmail: assignedUser.email,
            recipientName: assignedUser.name,
            recipientUserId: assignedUser.id,
            eventType,
            templateKey,
            variables: {
              task_id: taskId,
              taskId,
              task_title: task.title,
              description: task.description || 'No description provided.',
              assignee_name: assignedUser.name,
              creator_name: user.name,
              priority: task.priority,
              deadline: formatDeadline(task.deadline_at)
            }
          });
        }
      }

      logAudit(taskId, user.id, 'TASK_REASSIGNED', {
        assignees: assigned,
        previousAssignees: previous.map(p => p.user_id)
      });
    });

    dispatchEmails(emails); // only after the transaction has committed

    res.json({ success: true, message: 'Assignees updated successfully' });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// POST /api/tasks/:id/status - Update status/progress (Section 8, US-04, AT-02, AT-05)
// -------------------------------------------------------------
router.post('/:id/status', validateBody(schemas.status), (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      return next(new ApiError(404, 'NOT_FOUND', 'Task not found.'));
    }

    // RBAC: Check access (AT-09)
    if (!checkTaskAccess(taskId, user)) {
      return next(new ApiError(403, 'ACCESS_DENIED', 'Access denied: You are not assigned to this task.'));
    }

    const {
      status,
      remark,
      progress_pct
    } = req.body;

    if (!remark || !remark.trim()) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'A progress remark is required.'));
    }

    const oldStatus = task.status;
    const newStatus = status || oldStatus;
    if (!isStatusTransitionAllowed(oldStatus, newStatus, user.role)) {
      return next(new ApiError(422, 'INVALID_STATUS_TRANSITION', 'This status transition is not allowed for your role.'));
    }
    const newProgress = progress_pct !== undefined ? parseInt(progress_pct, 10) : task.progress_pct;
    const nowIso = getEffectiveNowISO();

    runAtomically(() => {
      // 1. Record update in task_updates (AT-02)
      db.prepare(`
        INSERT INTO task_updates (task_id, user_id, old_status, new_status, remark, progress_pct, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        user.id,
        oldStatus,
        newStatus,
        remark.trim(),
        newProgress,
        nowIso
      );

      // 2. Update task record AND reset last_progress_updated_at (AT-05: Inactivity timer resets!)
      db.prepare(`
        UPDATE tasks
        SET status = ?,
            progress_pct = ?,
            last_progress_updated_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        newStatus,
        newProgress,
        nowIso,
        nowIso,
        taskId
      );

      // 3. Log audit action
      logAudit(taskId, user.id, 'STATUS_UPDATED', {
        oldStatus,
        newStatus,
        remark: remark.trim(),
        progress_pct: newProgress
      });

      if (DONE_STATUSES.includes(oldStatus) && !TERMINAL_STATUSES.includes(newStatus)) {
        logAudit(taskId, user.id, 'TASK_REOPENED', { from: oldStatus, to: newStatus });
      }
    });

    const emails = [];

    // 4. If marked completed, notify Founder (Section 12)
    if (newStatus === 'Completed' && oldStatus !== 'Completed') {
      const founder = db.prepare("SELECT * FROM users WHERE role = 'founder' LIMIT 1").get();
      if (founder) {
        emails.push({
          taskId,
          recipientEmail: founder.email,
          recipientName: founder.name,
          recipientUserId: founder.id,
          eventType: 'Task Completed',
          templateKey: 'TASK_COMPLETED',
          variables: {
            task_id: taskId,
            taskId,
            task_title: task.title,
            assignee_name: user.name,
            recipient_name: founder.name,
            remark: remark.trim()
          }
        });
      }
    }

    // 5. Completed/Approved task moved back to an active status => Task Reopened
    if (DONE_STATUSES.includes(oldStatus) && !TERMINAL_STATUSES.includes(newStatus) && task.email_notifications_enabled) {
      emails.push(...buildReopenEmails(task, newStatus, user, remark.trim()));
    }

    dispatchEmails(emails);

    res.json({
      success: true,
      message: 'Status and progress updated successfully. Inactivity timer has been reset.',
      task: {
        id: taskId,
        status: newStatus,
        progress_pct: newProgress,
        last_progress_updated_at: nowIso
      }
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// POST /api/tasks/:id/comments - Add comment (Section 8)
// -------------------------------------------------------------
router.post('/:id/requests', validateBody(schemas.taskRequest), (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    if (!checkTaskAccess(taskId, user)) {
      return next(new ApiError(403, 'ACCESS_DENIED', 'Access denied: You are not assigned to this task.'));
    }

    const { request_type, message, requested_deadline } = req.body;
    const cleanedMessage = message.trim();
    if (!cleanedMessage) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Request message is required.'));
    }

    if (request_type === 'EXTENSION' && (!requested_deadline || !requested_deadline.trim())) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'A revised deadline is required for extension requests.'));
    }

    const nowIso = getEffectiveNowISO();
    const result = db.prepare(`
      INSERT INTO task_requests (task_id, requested_by, request_type, message, requested_deadline, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(taskId, user.id, request_type, cleanedMessage, requested_deadline || null, nowIso);

    logAudit(taskId, user.id, 'TASK_REQUEST_CREATED', {
      request_type,
      requested_deadline: requested_deadline || null,
      message: cleanedMessage.slice(0, 200)
    });

    res.status(201).json({
      success: true,
      requestId: result.lastInsertRowid,
      request_type,
      status: 'PENDING',
      created_at: nowIso
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/requests/:requestId', requireRole('founder', 'admin'), validateBody(schemas.taskRequestReview), (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;
    const requestId = parseInt(req.params.requestId, 10);
    const { status, decision_note } = req.body;

    const request = db.prepare('SELECT * FROM task_requests WHERE id = ? AND task_id = ?').get(requestId, taskId);
    if (!request) {
      return next(new ApiError(404, 'NOT_FOUND', 'Task request not found.'));
    }

    const nowIso = getEffectiveNowISO();
    const finalDecisionNote = decision_note ? decision_note.trim() : null;

    runAtomically(() => {
      db.prepare(`
        UPDATE task_requests
        SET status = ?, reviewed_by = ?, reviewed_at = ?, decision_note = ?
        WHERE id = ?
      `).run(status, user.id, nowIso, finalDecisionNote, requestId);

      if (status === 'APPROVED' && request.request_type === 'EXTENSION' && request.requested_deadline) {
        db.prepare(`
          UPDATE tasks
          SET deadline_at = ?, updated_at = ?
          WHERE id = ?
        `).run(request.requested_deadline, nowIso, taskId);

        db.prepare(`
          UPDATE task_requests
          SET final_deadline = ?
          WHERE id = ?
        `).run(request.requested_deadline, requestId);
      }

      logAudit(taskId, user.id, status === 'APPROVED' ? 'TASK_REQUEST_APPROVED' : 'TASK_REQUEST_REJECTED', {
        requestId,
        request_type: request.request_type,
        decision_note: finalDecisionNote,
        requested_deadline: request.requested_deadline || null
      });
    });

    res.json({
      success: true,
      requestId,
      status,
      reviewed_by: user.name,
      reviewed_at: nowIso
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments', validateBody(schemas.comment), (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    if (!checkTaskAccess(taskId, user)) {
      return next(new ApiError(403, 'ACCESS_DENIED', 'Access denied: You are not assigned to this task.'));
    }

    const { comment } = req.body;
    if (!comment || !comment.trim()) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Comment text is required.'));
    }

    const nowIso = getEffectiveNowISO();

    const result = db.prepare(`
      INSERT INTO task_comments (task_id, user_id, comment, created_at)
      VALUES (?, ?, ?, ?)
    `).run(taskId, user.id, comment.trim(), nowIso);

    logAudit(taskId, user.id, 'COMMENT_ADDED', { commentPreview: comment.trim().slice(0, 50) });

    res.status(201).json({
      success: true,
      commentId: result.lastInsertRowid,
      user_name: user.name,
      comment: comment.trim(),
      created_at: nowIso
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// GET /api/tasks/:id/history - Status & Activity history (Section 8, US-05)
// -------------------------------------------------------------
router.get('/:id/history', (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    if (!checkTaskAccess(taskId, user)) {
      return next(new ApiError(403, 'ACCESS_DENIED', 'Access denied: You are not assigned to this task.'));
    }

    const updates = db.prepare(`
      SELECT tu.*, u.name as user_name
      FROM task_updates tu
      JOIN users u ON tu.user_id = u.id
      WHERE tu.task_id = ?
      ORDER BY tu.created_at DESC
    `).all(taskId);

    const audit = db.prepare(`
      SELECT al.*, u.name as actor_name
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_user_id = u.id
      WHERE al.task_id = ?
      ORDER BY al.id DESC
    `).all(taskId);

    const reminders = db.prepare(`
      SELECT tr.*, u.name as recipient_name
      FROM task_reminders tr
      JOIN users u ON tr.recipient_user_id = u.id
      WHERE tr.task_id = ?
      ORDER BY tr.id DESC
    `).all(taskId);

    res.json({
      success: true,
      updates,
      audit: user.role === 'employee' ? [] : audit,
      reminders
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// POST /api/tasks/:id/remind - Manual reminder (Section 8)
// -------------------------------------------------------------
router.post('/:id/remind', requireRole('founder', 'admin'), validateBody(schemas.remind), async (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    if (user.role === 'employee') {
      return next(new ApiError(403, 'FORBIDDEN', 'Only Founder or Admin can send manual reminders.'));
    }

    const { message } = req.body;
    const sent = await sendManualReminder(taskId, user.id, message);

    res.json({
      success: true,
      message: `Manual reminder sent to ${sent.length} assignee(s).`,
      results: sent
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// GET /api/tasks/:id/attachments/:attachmentId/download - Secure attachment download
// -------------------------------------------------------------
router.get('/:id/attachments/:attachmentId/download', (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;
    const attachmentId = parseInt(req.params.attachmentId, 10);

    if (!checkTaskAccess(taskId, user)) {
      return next(new ApiError(403, 'ACCESS_DENIED', 'Access denied: You are not assigned to this task.'));
    }

    const attachment = db.prepare('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId);
    if (!attachment) {
      return next(new ApiError(404, 'NOT_FOUND', 'Attachment not found.'));
    }

    const diskPath = attachment.file_url && path.isAbsolute(attachment.file_url)
      ? attachment.file_url
      : path.join(ATTACHMENT_DIR, path.basename(attachment.file_url || attachment.file_name || 'attachment'));

    if (!fs.existsSync(diskPath)) {
      return next(new ApiError(404, 'NOT_FOUND', 'Attachment file is missing on disk.'));
    }

    res.download(diskPath, attachment.file_name || path.basename(diskPath));
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// POST /api/tasks/:id/attachments - Add attachment
// -------------------------------------------------------------
router.post('/:id/attachments', upload.single('file'), (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    if (!checkTaskAccess(taskId, user)) {
      return next(new ApiError(403, 'ACCESS_DENIED', 'Access denied: You are not assigned to this task.'));
    }

    const file = req.file;
    if (!file) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'A file is required.'));
    }

    const fileName = file.originalname || 'attachment';
    const storedDiskPath = path.join(ATTACHMENT_DIR, file.filename);
    const nowIso = getEffectiveNowISO();
    const result = db.prepare(`
      INSERT INTO task_attachments (task_id, uploaded_by, file_url, file_name, file_size, file_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, user.id, storedDiskPath, fileName, file.size, file.mimetype || 'application/octet-stream', nowIso);

    const attachmentId = Number(result.lastInsertRowid);
    logAudit(taskId, user.id, 'ATTACHMENT_ADDED', { fileName });

    res.status(201).json({
      success: true,
      attachmentId,
      file_name: fileName,
      file_url: `/api/tasks/${taskId}/attachments/${attachmentId}/download`,
      uploaded_by: user.name,
      created_at: nowIso
    });
  } catch (err) {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(400, 'VALIDATION_ERROR', `File exceeds the maximum allowed size of ${Math.round(attachmentMaxBytes / (1024 * 1024))} MB.`));
    }
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new ApiError(400, 'VALIDATION_ERROR', err.message));
    }
    next(err);
  }
});

module.exports = router;