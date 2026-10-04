const express = require('express');
const router = express.Router();
const { db, getEffectiveNow, getEffectiveNowISO } = require('../db/database');
const { calculateTaskFlags, sendManualReminder } = require('../services/reminderEngine');
const { sendEmail } = require('../services/emailService');
const { logAudit } = require('../services/auditService');
const { ApiError } = require('../middleware/errors');
const { requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { schemas } = require('../validation');

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
      limit = 100,
      page = 1
    } = req.query;

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
        tasks = tasks.filter(t => t.hours_until_deadline >= 0 && t.hours_until_deadline <= 24 && !['Completed', 'Approved', 'Cancelled'].includes(t.status));
      } else if (tab === 'upcoming') {
        tasks = tasks.filter(t => t.hours_until_deadline > 24 && !['Completed', 'Approved', 'Cancelled'].includes(t.status));
      } else if (tab === 'overdue') {
        tasks = tasks.filter(t => t.is_overdue);
      } else if (tab === 'completed') {
        tasks = tasks.filter(t => ['Completed', 'Approved'].includes(t.status));
      }
    }

    // Pagination
    const totalCount = tasks.length;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const paginated = tasks.slice(offset, offset + parseInt(limit, 10));

    res.json({
      success: true,
      total: totalCount,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(totalCount / parseInt(limit, 10)) || 1,
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
        updates,
        comments,
        reminders,
        attachments,
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

    // Generate readable Task ID (TASK-101, TASK-102, ...)
    const maxRow = db.prepare(`
      SELECT id FROM tasks WHERE id LIKE 'TASK-%' ORDER BY CAST(SUBSTR(id, 6) AS INTEGER) DESC LIMIT 1
    `).get();

    let nextNumber = 101;
    if (maxRow && maxRow.id) {
      const parsed = parseInt(maxRow.id.replace('TASK-', ''), 10);
      if (!isNaN(parsed)) nextNumber = parsed + 1;
    }
    const taskId = `TASK-${nextNumber}`;

    const insertTask = db.prepare(`
      INSERT INTO tasks (
        id, title, description, instructions, created_by, priority,
        start_at, deadline_at, status, progress_pct, recurrence_rule,
        reminder_policy_id, email_notifications_enabled,
        last_progress_updated_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New', 0, ?, ?, ?, ?, ?, ?)
    `);

    insertTask.run(
      taskId,
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

    // Process assignees
    let assignedList = [];
    if (primary_assignee_id) {
      assignedList.push({ userId: parseInt(primary_assignee_id, 10), responsibility: 'primary' });
    }
    if (Array.isArray(assignee_ids)) {
      for (const item of assignee_ids) {
        const uid = typeof item === 'object' ? item.userId : parseInt(item, 10);
        const resp = typeof item === 'object' ? item.responsibility : 'contributor';
        if (uid && !assignedList.some(a => a.userId === uid)) {
          assignedList.push({ userId: uid, responsibility: resp });
        }
      }
    }

    // Default to at least one assignee if provided
    for (const a of assignedList) {
      db.prepare(`
        INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
        VALUES (?, ?, ?, ?, 1)
      `).run(taskId, a.userId, a.responsibility, nowIso);

      // Send assignment email (AT-01)
      const assignedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(a.userId);
      if (assignedUser && email_notifications_enabled) {
        sendEmail({
          taskId,
          recipientEmail: assignedUser.email,
          recipientName: assignedUser.name,
          recipientUserId: assignedUser.id,
          eventType: 'New Task Assigned',
          templateKey: 'NEW_TASK_ASSIGNED',
          variables: {
            task_id: taskId,
            taskId,
            task_title: title.trim(),
            description: description || 'No description provided.',
            assignee_name: assignedUser.name,
            creator_name: user.name,
            priority,
            deadline: new Date(deadline_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          }
        });
      }
    }

    logAudit(taskId, user.id, 'TASK_CREATED', {
      title,
      priority,
      deadline_at,
      assignees: assignedList
    });

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

    logAudit(taskId, user.id, 'TASK_EDITED', { updatedFields: req.body });

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

    // Remove existing assignments and replace with new
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);

    const assigned = [];
    if (primary_user_id) {
      assigned.push({ userId: parseInt(primary_user_id, 10), responsibility: 'primary' });
    }
    for (const item of assignee_ids) {
      const uid = typeof item === 'object' ? item.userId : parseInt(item, 10);
      const resp = typeof item === 'object' ? item.responsibility : 'contributor';
      if (uid && !assigned.some(a => a.userId === uid)) {
        assigned.push({ userId: uid, responsibility: resp });
      }
    }

    for (const a of assigned) {
      db.prepare(`
        INSERT INTO task_assignees (task_id, user_id, responsibility_type, assigned_at, active)
        VALUES (?, ?, ?, ?, 1)
      `).run(taskId, a.userId, a.responsibility, nowIso);

      const assignedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(a.userId);
      if (assignedUser && task.email_notifications_enabled) {
        sendEmail({
          taskId,
          recipientEmail: assignedUser.email,
          recipientName: assignedUser.name,
          recipientUserId: assignedUser.id,
          eventType: 'Assignment Changed',
          templateKey: 'ASSIGNMENT_CHANGED',
          variables: {
            task_id: taskId,
            taskId,
            task_title: task.title,
            assignee_name: assignedUser.name,
            creator_name: user.name
          }
        });
      }
    }

    logAudit(taskId, user.id, 'TASK_REASSIGNED', { assignees: assigned });

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
    const newProgress = progress_pct !== undefined ? parseInt(progress_pct, 10) : task.progress_pct;
    const nowIso = getEffectiveNowISO();

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

    // 4. If marked completed, notify Founder (Section 12)
    if (newStatus === 'Completed' && oldStatus !== 'Completed') {
      const founder = db.prepare('SELECT * FROM users WHERE role = "founder" LIMIT 1').get();
      if (founder) {
        sendEmail({
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
router.post('/:id/remind', requireRole('founder', 'admin'), validateBody(schemas.remind), (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    if (user.role === 'employee') {
      return next(new ApiError(403, 'FORBIDDEN', 'Only Founder or Admin can send manual reminders.'));
    }

    const { message } = req.body;
    const sent = sendManualReminder(taskId, user.id, message);

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
// POST /api/tasks/:id/attachments - Add attachment
// -------------------------------------------------------------
router.post('/:id/attachments', validateBody(schemas.attachment), (req, res, next) => {
  try {
    const user = req.user;
    const taskId = req.params.id;

    if (!checkTaskAccess(taskId, user)) {
      return next(new ApiError(403, 'ACCESS_DENIED', 'Access denied: You are not assigned to this task.'));
    }

    const { file_name, file_url, file_size = 102400, file_type = 'application/pdf' } = req.body;
    if (!file_name) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'File name is required.'));
    }

    const nowIso = getEffectiveNowISO();
    const result = db.prepare(`
      INSERT INTO task_attachments (task_id, uploaded_by, file_url, file_name, file_size, file_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, user.id, file_url || `/uploads/${file_name}`, file_name, file_size, file_type, nowIso);

    logAudit(taskId, user.id, 'ATTACHMENT_ADDED', { fileName: file_name });

    res.status(201).json({
      success: true,
      attachmentId: result.lastInsertRowid,
      file_name,
      file_url: file_url || `/uploads/${file_name}`,
      uploaded_by: user.name,
      created_at: nowIso
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
