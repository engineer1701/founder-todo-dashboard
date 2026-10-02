const express = require('express');
const router = express.Router();
const { db, getEffectiveNow } = require('../db/database');
const { calculateTaskFlags } = require('../services/reminderEngine');

router.get('/', (req, res) => {
  try {
    const effectiveNow = getEffectiveNow();
    const effectiveNowTime = effectiveNow.getTime();

    // Fetch all tasks with policies and assignees
    const allTasks = db.prepare(`
      SELECT t.*,
             rp.name as policy_name, rp.first_reminder_hours, rp.second_reminder_hours, rp.escalation_hours,
             u.name as creator_name
      FROM tasks t
      LEFT JOIN reminder_policies rp ON t.reminder_policy_id = rp.id
      LEFT JOIN users u ON t.created_by = u.id
      ORDER BY t.created_at DESC
    `).all();

    let total = allTasks.length;
    let newCount = 0;
    let inProgressCount = 0;
    let completedCount = 0;
    let overdueCount = 0;
    let noUpdateCount = 0;
    let dueTodayCount = 0;
    let dueTomorrowCount = 0;
    let criticalCount = 0;

    const enrichedTasks = allTasks.map(task => {
      const flags = calculateTaskFlags(task, effectiveNow);
      const isTerminal = ['Completed', 'Approved', 'Cancelled'].includes(task.status);
      const deadline = new Date(task.deadline_at).getTime();
      const diffHours = (deadline - effectiveNowTime) / (1000 * 3600);

      if (task.status === 'New') newCount++;
      if (task.status === 'In Progress') inProgressCount++;
      if (task.status === 'Completed' || task.status === 'Approved') completedCount++;

      if (flags.is_overdue) overdueCount++;
      if (flags.is_no_update_alert) noUpdateCount++;

      if (!isTerminal) {
        if (diffHours >= 0 && diffHours <= 24) dueTodayCount++;
        else if (diffHours > 24 && diffHours <= 48) dueTomorrowCount++;

        if (task.priority === 'Critical') criticalCount++;
      }

      const assignees = db.prepare(`
        SELECT u.id, u.name, u.email, u.avatar_url, ta.responsibility_type
        FROM task_assignees ta
        JOIN users u ON ta.user_id = u.id
        WHERE ta.task_id = ? AND ta.active = 1
      `).all(task.id);

      return {
        ...task,
        ...flags,
        assignees,
        primary_assignee: assignees.find(a => a.responsibility_type === 'primary') || assignees[0] || null
      };
    });

    // Recent activity feed
    const recentActivity = db.prepare(`
      SELECT al.*, u.name as actor_name, t.title as task_title
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_user_id = u.id
      LEFT JOIN tasks t ON al.task_id = t.id
      ORDER BY al.id DESC
      LIMIT 10
    `).all();

    // Priority breakdown
    const priorityBreakdown = {
      Critical: allTasks.filter(t => t.priority === 'Critical').length,
      High: allTasks.filter(t => t.priority === 'High').length,
      Medium: allTasks.filter(t => t.priority === 'Medium').length,
      Low: allTasks.filter(t => t.priority === 'Low').length
    };

    // Status breakdown
    const statusBreakdown = {};
    for (const t of allTasks) {
      statusBreakdown[t.status] = (statusBreakdown[t.status] || 0) + 1;
    }

    res.json({
      success: true,
      summary: {
        total,
        new: newCount,
        in_progress: inProgressCount,
        completed: completedCount,
        overdue: overdueCount,
        no_update: noUpdateCount,
        due_today: dueTodayCount,
        due_tomorrow: dueTomorrowCount,
        critical: criticalCount
      },
      priorityBreakdown,
      statusBreakdown,
      recentActivity,
      tasks: enrichedTasks.slice(0, 15) // Recent 15 tasks for quick table preview
    });
  } catch (err) {
    console.error('[GET /api/dashboard error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
