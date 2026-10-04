const express = require('express');
const router = express.Router();
const { db, getEffectiveNow } = require('../db/database');
const { calculateTaskFlags } = require('../services/reminderEngine');
const { requireRole } = require('../middleware/auth');

router.get('/tasks', requireRole('founder', 'admin'), (req, res, next) => {
  try {
    const effectiveNow = getEffectiveNow();
    const { department_id, start_date, end_date } = req.query;

    let userQuery = `
      SELECT u.id, u.name, u.email, u.role, u.designation, u.avatar_url, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.role = 'employee' AND u.status = 'active'
    `;
    const userParams = [];

    if (department_id) {
      userQuery += ` AND u.department_id = ? `;
      userParams.push(parseInt(department_id, 10));
    }

    const employees = db.prepare(userQuery).all(...userParams);

    // Get all tasks
    const tasks = db.prepare(`
      SELECT t.*, rp.first_reminder_hours, rp.second_reminder_hours, rp.escalation_hours
      FROM tasks t
      LEFT JOIN reminder_policies rp ON t.reminder_policy_id = rp.id
    `).all();

    // Map tasks by ID for quick lookup
    const taskMap = new Map();
    for (const t of tasks) {
      const flags = calculateTaskFlags(t, effectiveNow);
      taskMap.set(t.id, { ...t, ...flags });
    }

    // Get all assignments
    const assignments = db.prepare(`
      SELECT task_id, user_id, responsibility_type FROM task_assignees WHERE active = 1
    `).all();

    const employeeReports = employees.map(emp => {
      const empTaskIds = assignments.filter(a => a.user_id === emp.id).map(a => a.task_id);
      const empTasks = empTaskIds.map(id => taskMap.get(id)).filter(Boolean);

      const assignedCount = empTasks.length;
      const completedTasks = empTasks.filter(t => ['Completed', 'Approved'].includes(t.status));
      const completedCount = completedTasks.length;
      const pendingCount = assignedCount - completedCount;
      const overdueCount = empTasks.filter(t => t.is_overdue).length;
      const noUpdateCount = empTasks.filter(t => t.is_no_update_alert).length;

      // Completion time calculation (hours between created_at and last_progress_updated_at for completed tasks)
      let totalCompletionHours = 0;
      for (const t of completedTasks) {
        const start = new Date(t.created_at).getTime();
        const end = new Date(t.last_progress_updated_at || t.updated_at).getTime();
        totalCompletionHours += Math.max(0, (end - start) / (1000 * 3600));
      }
      const avgCompletionHours = completedCount > 0 ? (totalCompletionHours / completedCount).toFixed(1) : 'N/A';
      const completionRate = assignedCount > 0 ? Math.round((completedCount / assignedCount) * 100) : 0;

      return {
        id: emp.id,
        name: emp.name,
        email: emp.email,
        designation: emp.designation,
        department: emp.department_name,
        avatar_url: emp.avatar_url,
        assigned_tasks: assignedCount,
        completed_tasks: completedCount,
        pending_tasks: pendingCount,
        overdue_tasks: overdueCount,
        no_update_tasks: noUpdateCount,
        completion_rate_pct: completionRate,
        avg_completion_hours: avgCompletionHours
      };
    });

    // Overall summary metrics
    const totalTasks = tasks.length;
    const totalCompleted = tasks.filter(t => ['Completed', 'Approved'].includes(t.status)).length;
    const totalOverdue = Array.from(taskMap.values()).filter(t => t.is_overdue).length;
    const totalNoUpdate = Array.from(taskMap.values()).filter(t => t.is_no_update_alert).length;

    res.json({
      success: true,
      overall: {
        total_tasks: totalTasks,
        total_completed: totalCompleted,
        total_pending: totalTasks - totalCompleted,
        total_overdue: totalOverdue,
        total_no_update: totalNoUpdate,
        overall_completion_rate: totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0
      },
      employeeReports
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
