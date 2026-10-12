import React, { useState } from 'react';
import {
  Search,
  Filter,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Calendar,
  Send,
  MoreVertical,
  Plus,
  RefreshCw,
  Eye,
  SlidersHorizontal,
  Flame,
  UserCheck
} from 'lucide-react';

export default function DashboardView({
  dashboardData,
  tasks,
  loading,
  users,
  departments,
  currentUser,
  onRefresh,
  onOpenCreateModal,
  onSelectTask,
  onManualRemind,
  onFilterChange,
  activeFilterCard,
  setActiveFilterCard
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [noUpdateOnly, setNoUpdateOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editMessage, setEditMessage] = useState({ type: '', text: '' });

  const isManager = ['founder', 'admin'].includes(currentUser?.role);

  const formatForInput = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const openEditTask = (task) => {
    setEditingTaskId(task.id);
    setEditMessage({ type: '', text: '' });
    setEditForm({
      title: task.title || '',
      description: task.description || '',
      instructions: task.instructions || '',
      priority: task.priority || 'Medium',
      start_at: formatForInput(task.start_at),
      deadline_at: formatForInput(task.deadline_at),
      reminder_policy_id: task.reminder_policy_id || '',
      email_notifications_enabled: Boolean(task.email_notifications_enabled)
    });
  };

  const saveEditTask = async (task) => {
    try {
      setEditMessage({ type: '', text: '' });
      const payload = {
        title: editForm.title,
        description: editForm.description,
        instructions: editForm.instructions,
        priority: editForm.priority,
        start_at: editForm.start_at || null,
        deadline_at: editForm.deadline_at || null,
        reminder_policy_id: editForm.reminder_policy_id ? Number(editForm.reminder_policy_id) : null,
        email_notifications_enabled: !!editForm.email_notifications_enabled
      };

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message || data?.error || 'Failed to save task');
      }

      setEditMessage({ type: 'success', text: `Task ${task.id} updated successfully.` });
      setEditingTaskId(null);
      if (onRefresh) await onRefresh();
    } catch (error) {
      setEditMessage({ type: 'error', text: error.message || 'Task update failed.' });
    }
  };

  // Filter tasks locally or apply
  const summary = dashboardData?.summary || {
    total: 0,
    new: 0,
    in_progress: 0,
    completed: 0,
    overdue: 0,
    no_update: 0,
    due_today: 0,
    due_tomorrow: 0,
    critical: 0
  };

  const handleCardClick = (cardKey) => {
    if (activeFilterCard === cardKey) {
      setActiveFilterCard(null);
      setStatusFilter('');
      setOverdueOnly(false);
      setNoUpdateOnly(false);
      setPriorityFilter('');
    } else {
      setActiveFilterCard(cardKey);
      if (cardKey === 'new') setStatusFilter('New');
      else if (cardKey === 'in_progress') setStatusFilter('In Progress');
      else if (cardKey === 'completed') setStatusFilter('Completed');
      else if (cardKey === 'overdue') { setOverdueOnly(true); setStatusFilter(''); }
      else if (cardKey === 'no_update') { setNoUpdateOnly(true); setStatusFilter(''); }
      else if (cardKey === 'critical') { setPriorityFilter('Critical'); setStatusFilter(''); }
      else {
        setStatusFilter('');
        setOverdueOnly(false);
        setNoUpdateOnly(false);
        setPriorityFilter('');
      }
    }
  };

  const filteredTasks = tasks.filter((t) => {
    if (searchTerm) {
      const match =
        t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.description && t.description.toLowerCase().includes(searchTerm.toLowerCase()));
      if (!match) return false;
    }
    if (statusFilter && t.status !== statusFilter) return false;
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (assigneeFilter && !t.assignees?.some((a) => a.id === parseInt(assigneeFilter, 10))) return false;
    if (overdueOnly && !t.is_overdue) return false;
    if (noUpdateOnly && !t.is_no_update_alert) return false;
    return true;
  });

  const inactiveTasksCount = tasks.filter((t) => t.is_no_update_alert).length;
  const overdueTasksCount = tasks.filter((t) => t.is_overdue).length;

  return (
    <div>
      {/* Metrics Cards Grid - Section 5.1 */}
      <div className="metrics-grid">
        <div
          className={`metric-card ${activeFilterCard === 'total' ? 'active' : ''}`}
          onClick={() => handleCardClick('total')}
          id="metric-total-card"
        >
          <div className="metric-header">
            <span>Total Tasks</span>
            <CheckCircle2 size={16} />
          </div>
          <div className="metric-val">{summary.total}</div>
        </div>

        <div
          className={`metric-card ${activeFilterCard === 'new' ? 'active' : ''}`}
          onClick={() => handleCardClick('new')}
          id="metric-new-card"
        >
          <div className="metric-header">
            <span>New</span>
            <span className="badge badge-new">{summary.new}</span>
          </div>
          <div className="metric-val">{summary.new}</div>
        </div>

        <div
          className={`metric-card ${activeFilterCard === 'in_progress' ? 'active' : ''}`}
          onClick={() => handleCardClick('in_progress')}
          id="metric-in-progress-card"
        >
          <div className="metric-header">
            <span>In Progress</span>
            <span className="badge badge-progress">{summary.in_progress}</span>
          </div>
          <div className="metric-val">{summary.in_progress}</div>
        </div>

        <div
          className={`metric-card ${activeFilterCard === 'completed' ? 'active' : ''}`}
          onClick={() => handleCardClick('completed')}
          id="metric-completed-card"
        >
          <div className="metric-header">
            <span>Completed</span>
            <span className="badge badge-completed">{summary.completed}</span>
          </div>
          <div className="metric-val">{summary.completed}</div>
        </div>

        <div
          className={`metric-card card-overdue ${activeFilterCard === 'overdue' ? 'active' : ''}`}
          onClick={() => handleCardClick('overdue')}
          id="metric-overdue-card"
        >
          <div className="metric-header">
            <span style={{ color: '#dc2626' }}>Overdue</span>
            <AlertTriangle size={16} color="#dc2626" />
          </div>
          <div className="metric-val">{summary.overdue}</div>
        </div>

        <div
          className={`metric-card card-no-update ${activeFilterCard === 'no_update' ? 'active' : ''}`}
          onClick={() => handleCardClick('no_update')}
          id="metric-no-update-card"
        >
          <div className="metric-header">
            <span style={{ color: '#d97706' }}>No Update</span>
            <Clock size={16} color="#d97706" />
          </div>
          <div className="metric-val">{summary.no_update}</div>
        </div>

        <div
          className={`metric-card ${activeFilterCard === 'due_today' ? 'active' : ''}`}
          onClick={() => handleCardClick('due_today')}
          id="metric-due-today-card"
        >
          <div className="metric-header">
            <span>Due Today</span>
            <Calendar size={16} />
          </div>
          <div className="metric-val">{summary.due_today}</div>
        </div>

        <div
          className={`metric-card ${activeFilterCard === 'due_tomorrow' ? 'active' : ''}`}
          onClick={() => handleCardClick('due_tomorrow')}
          id="metric-due-tomorrow-card"
        >
          <div className="metric-header">
            <span>Due Tomorrow</span>
            <Calendar size={16} />
          </div>
          <div className="metric-val">{summary.due_tomorrow}</div>
        </div>

        <div
          className={`metric-card card-critical ${activeFilterCard === 'critical' ? 'active' : ''}`}
          onClick={() => handleCardClick('critical')}
          id="metric-critical-card"
        >
          <div className="metric-header">
            <span style={{ color: '#e11d48' }}>Critical</span>
            <Flame size={16} color="#e11d48" />
          </div>
          <div className="metric-val">{summary.critical}</div>
        </div>
      </div>

      {/* Inactivity Alert Banner if any task reached threshold */}
      {(inactiveTasksCount > 0 || overdueTasksCount > 0) && (
        <div className="urgency-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <AlertTriangle size={20} color="#d97706" />
            <div>
              <strong>Founder Attention Required:</strong> {inactiveTasksCount} active task(s) currently exceed the inactivity threshold without employee remarks, and {overdueTasksCount} task(s) have crossed their scheduled deadlines.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-secondary"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', background: '#ffffff' }}
              onClick={() => { setNoUpdateOnly(true); setOverdueOnly(false); }}
            >
              Filter No-Update ({inactiveTasksCount})
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', background: '#fee2e2', color: '#b91c1c', borderColor: '#fca5a5' }}
              onClick={() => { setOverdueOnly(true); setNoUpdateOnly(false); }}
            >
              Filter Overdue ({overdueTasksCount})
            </button>
          </div>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="toolbar-card">
        {editMessage.text && (
          <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', fontSize: '0.85rem', fontWeight: 600, background: editMessage.type === 'success' ? '#dcfce7' : '#fee2e2', color: editMessage.type === 'success' ? '#166534' : '#991b1b' }}>
            {editMessage.text}
          </div>
        )}

        <div className="search-input-wrap">
          <Search size={16} color="#94a3b8" />
          <input
            type="text"
            placeholder="Search by Task ID, title, keyword..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            id="task-search-input"
          />
        </div>

        <div className="filter-group">
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            id="filter-status-select"
          >
            <option value="">All Statuses</option>
            <option value="New">New</option>
            <option value="Acknowledged">Acknowledged</option>
            <option value="In Progress">In Progress</option>
            <option value="Awaiting Information">Awaiting Information</option>
            <option value="On Hold">On Hold</option>
            <option value="Submitted for Review">Submitted for Review</option>
            <option value="Rework Required">Rework Required</option>
            <option value="Completed">Completed</option>
            <option value="Approved">Approved</option>
            <option value="Cancelled">Cancelled</option>
          </select>

          <select
            className="filter-select"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            id="filter-priority-select"
          >
            <option value="">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>

          <select
            className="filter-select"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            id="filter-assignee-select"
          >
            <option value="">All Assignees</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600, color: '#b45309' }}>
            <input
              type="checkbox"
              checked={noUpdateOnly}
              onChange={(e) => setNoUpdateOnly(e.target.checked)}
              id="filter-no-update-checkbox"
            />
            No Update Alert
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600, color: '#b91c1c' }}>
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              id="filter-overdue-checkbox"
            />
            Overdue Only
          </label>

          <button className="btn-secondary" onClick={onRefresh} title="Refresh Live Data" id="refresh-dashboard-btn">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Main Table - Section 5.1 */}
      <div className="table-container">
        <table className="data-table" id="founder-tasks-table">
          <thead>
            <tr>
              <th>Task ID</th>
              <th>Task & Description</th>
              <th>Assignee</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Deadline</th>
              <th>Last Updated</th>
              <th>No Update For</th>
              <th>Reminder Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="10" style={{ textAlign: 'center', padding: '2rem' }}>
                  Loading real-time task allocations...
                </td>
              </tr>
            ) : filteredTasks.length === 0 ? (
              <tr>
                <td colSpan="10">
                  <div className="empty-state">
                    <CheckCircle2 size={36} />
                    <h4>No tasks match the active filters</h4>
                    <p>Try clearing filters or create a new task allocation.</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => {
                const primary = task.primary_assignee || task.assignees?.[0];
                const isOverdue = task.is_overdue;
                const isNoUpdate = task.is_no_update_alert;

                return (
                  <tr
                    key={task.id}
                    className={`${isOverdue ? 'row-overdue' : ''} ${isNoUpdate ? 'row-no-update' : ''}`}
                    id={`task-row-${task.id}`}
                  >
                    <td>
                      <span
                        className="task-id-badge"
                        style={{ cursor: 'pointer' }}
                        onClick={() => onSelectTask(task.id)}
                      >
                        {task.id}
                      </span>
                    </td>

                    <td className="task-title-cell">
                      <span
                        className="task-title-text"
                        onClick={() => onSelectTask(task.id)}
                      >
                        {task.title}
                      </span>
                      <div className="task-desc-preview">{task.description || 'No description'}</div>
                    </td>

                    <td>
                      {primary ? (
                        <div className="assignee-pill" title={`${primary.name} (${primary.responsibility_type || 'primary'})`}>
                          <img
                            src={primary.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&q=80'}
                            alt={primary.name}
                            className="assignee-avatar"
                          />
                          <span>{primary.name.split(' ')[0]}</span>
                          {task.assignees?.length > 1 && (
                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                              +{task.assignees.length - 1}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Unassigned</span>
                      )}
                    </td>

                    <td>
                      <span className={`badge badge-priority-${task.priority?.toLowerCase()}`}>
                        {task.priority}
                      </span>
                    </td>

                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <span
                          className={`badge ${
                            task.status === 'New'
                              ? 'badge-new'
                              : task.status === 'In Progress'
                              ? 'badge-progress'
                              : task.status === 'Awaiting Information'
                              ? 'badge-awaiting'
                              : task.status === 'On Hold'
                              ? 'badge-hold'
                              : task.status === 'Submitted for Review'
                              ? 'badge-review'
                              : task.status === 'Completed' || task.status === 'Approved'
                              ? 'badge-completed'
                              : 'badge-hold'
                          }`}
                        >
                          {task.status}
                        </span>

                        {isOverdue && (
                          <span className="badge badge-overdue" title="Overdue (Section 4 calculated flag)">
                            ⚠️ Overdue
                          </span>
                        )}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontSize: '0.825rem', fontWeight: 500 }}>
                        {new Date(task.deadline_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                      <div
                        style={{
                          fontSize: '0.725rem',
                          color: isOverdue ? '#dc2626' : '#64748b',
                          fontWeight: isOverdue ? 700 : 400
                        }}
                      >
                        {isOverdue
                          ? `${Math.abs(task.hours_until_deadline)}h overdue`
                          : `${task.hours_until_deadline}h remaining`}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontSize: '0.825rem' }}>
                        {new Date(task.last_progress_updated_at || task.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </td>

                    <td>
                      {task.hours_inactive >= 48 ? (
                        <span className="inactivity-critical-pill">
                          <Flame size={12} /> {task.hours_inactive} hrs
                        </span>
                      ) : task.hours_inactive >= 24 ? (
                        <span className="inactivity-warning-pill">
                          <Clock size={12} /> {task.hours_inactive} hrs
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.825rem', color: '#64748b' }}>
                          {task.hours_inactive} hrs
                        </span>
                      )}
                    </td>

                    <td>
                      <span
                        className={`badge ${
                          task.reminder_stage?.includes('Escalated')
                            ? 'badge-escalated'
                            : task.reminder_stage?.includes('Reminder')
                            ? 'badge-awaiting'
                            : 'badge-hold'
                        }`}
                      >
                        {task.reminder_stage || 'None'}
                      </span>
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          className="btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          onClick={() => onManualRemind(task.id)}
                          title="Send Manual Follow-Up Nudge"
                          id={`nudge-btn-${task.id}`}
                        >
                          <Send size={12} /> Nudge
                        </button>
                        {isManager && (
                          <button
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                            onClick={() => openEditTask(task)}
                            id={`edit-btn-${task.id}`}
                          >
                            Edit Task
                          </button>
                        )}
                        <button
                          className="btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          onClick={() => onSelectTask(task.id)}
                          id={`view-btn-${task.id}`}
                        >
                          <Eye size={12} /> View
                        </button>
                      </div>

                      {editingTaskId === task.id && (
                        <div style={{ marginTop: '0.75rem', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: '#f8fafc', textAlign: 'left', minWidth: '280px' }}>
                          <div style={{ display: 'grid', gap: '0.5rem' }}>
                            <input
                              type="text"
                              value={editForm.title || ''}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                              placeholder="Title"
                              style={{ padding: '0.5rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '0.35rem' }}
                            />
                            <textarea
                              value={editForm.description || ''}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                              placeholder="Description"
                              rows={3}
                              style={{ padding: '0.5rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '0.35rem', resize: 'vertical' }}
                            />
                            <textarea
                              value={editForm.instructions || ''}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, instructions: e.target.value }))}
                              placeholder="Instructions"
                              rows={3}
                              style={{ padding: '0.5rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '0.35rem', resize: 'vertical' }}
                            />

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                              <select
                                value={editForm.priority || 'Medium'}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, priority: e.target.value }))}
                                style={{ padding: '0.5rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '0.35rem' }}
                              >
                                <option value="Critical">Critical</option>
                                <option value="High">High</option>
                                <option value="Medium">Medium</option>
                                <option value="Low">Low</option>
                              </select>

                              <select
                                value={editForm.reminder_policy_id ?? ''}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, reminder_policy_id: e.target.value }))}
                                style={{ padding: '0.5rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '0.35rem' }}
                              >
                                <option value="">Default Policy</option>
                                <option value="1">Standard</option>
                                <option value="2">Urgent</option>
                                <option value="3">Relaxed</option>
                              </select>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                              <input
                                type="datetime-local"
                                value={editForm.start_at || ''}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, start_at: e.target.value }))}
                                style={{ padding: '0.5rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '0.35rem' }}
                              />
                              <input
                                type="datetime-local"
                                value={editForm.deadline_at || ''}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, deadline_at: e.target.value }))}
                                style={{ padding: '0.5rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '0.35rem' }}
                              />
                            </div>

                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', fontWeight: 600 }}>
                              <input
                                type="checkbox"
                                checked={!!editForm.email_notifications_enabled}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, email_notifications_enabled: e.target.checked }))}
                              />
                              Email notifications enabled
                            </label>

                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                              <button className="btn-secondary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.75rem' }} onClick={() => setEditingTaskId(null)}>
                                Cancel
                              </button>
                              <button className="btn-primary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.75rem' }} onClick={() => saveEditTask(task)}>
                                Save
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
