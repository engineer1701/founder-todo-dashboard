import React, { useState } from 'react';
import {
  CheckCircle,
  Clock,
  AlertCircle,
  Calendar,
  MessageSquare,
  FileText,
  Send,
  Eye,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

export default function EmployeeView({
  currentUser,
  tasks,
  loading,
  onSelectTask,
  onQuickUpdateStatus
}) {
  const [activeTab, setActiveTab] = useState('all'); // all, new, active, due_today, upcoming, overdue, completed

  // Filter tasks belonging to current logged in employee
  const myTasks = tasks.filter((t) =>
    t.assignees?.some((a) => a.id === currentUser?.id)
  );

  const newTasks = myTasks.filter((t) => t.status === 'New');
  const activeTasks = myTasks.filter((t) =>
    ['Acknowledged', 'In Progress', 'Awaiting Information', 'Rework Required'].includes(t.status)
  );
  const dueTodayTasks = myTasks.filter(
    (t) =>
      t.hours_until_deadline >= 0 &&
      t.hours_until_deadline <= 24 &&
      !['Completed', 'Approved', 'Cancelled'].includes(t.status)
  );
  const upcomingTasks = myTasks.filter(
    (t) =>
      t.hours_until_deadline > 24 &&
      !['Completed', 'Approved', 'Cancelled'].includes(t.status)
  );
  const overdueTasks = myTasks.filter((t) => t.is_overdue);
  const completedTasks = myTasks.filter((t) =>
    ['Completed', 'Approved'].includes(t.status)
  );

  let displayedTasks = myTasks;
  if (activeTab === 'new') displayedTasks = newTasks;
  else if (activeTab === 'active') displayedTasks = activeTasks;
  else if (activeTab === 'due_today') displayedTasks = dueTodayTasks;
  else if (activeTab === 'upcoming') displayedTasks = upcomingTasks;
  else if (activeTab === 'overdue') displayedTasks = overdueTasks;
  else if (activeTab === 'completed') displayedTasks = completedTasks;

  const needingUpdate = myTasks.filter((t) => t.is_no_update_alert);

  const handleQuickAcknowledge = async (task) => {
    await onQuickUpdateStatus(task.id, 'Acknowledged', 'Acknowledged task and commenced review.', 10);
  };

  return (
    <div>
      {/* Employee Greeting & Notice */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.45rem', fontWeight: 700 }}>
          My Task Workspace — {currentUser?.name}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Role: {currentUser?.designation || currentUser?.department_name} • Manage assigned deliverables, log progress updates, and keep management informed.
        </p>
      </div>

      {/* Inactivity Nudge Warning */}
      {needingUpdate.length > 0 && (
        <div className="urgency-banner" style={{ background: '#fffbeb', borderColor: '#f59e0b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <AlertTriangle size={20} color="#d97706" />
            <div>
              <strong>Follow-Up Alert:</strong> You have {needingUpdate.length} active task(s) awaiting a progress remark to reset automated reminder escalation.
            </div>
          </div>
          <button
            className="btn-primary"
            style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem', background: '#d97706' }}
            onClick={() => onSelectTask(needingUpdate[0].id)}
          >
            Update First Pending Task
          </button>
        </div>
      )}

      {/* Employee Tab Filters - Section 6 */}
      <div className="tabs-container">
        <button
          className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
          id="tab-all"
        >
          All Tasks <span className="tab-badge">{myTasks.length}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'new' ? 'active' : ''}`}
          onClick={() => setActiveTab('new')}
          id="tab-new"
        >
          New (Unacknowledged) <span className="tab-badge">{newTasks.length}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
          id="tab-active"
        >
          Active Work <span className="tab-badge">{activeTasks.length}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'due_today' ? 'active' : ''}`}
          onClick={() => setActiveTab('due_today')}
          id="tab-due-today"
        >
          Due Today <span className="tab-badge">{dueTodayTasks.length}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'upcoming' ? 'active' : ''}`}
          onClick={() => setActiveTab('upcoming')}
          id="tab-upcoming"
        >
          Upcoming <span className="tab-badge">{upcomingTasks.length}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'overdue' ? 'active' : ''}`}
          onClick={() => setActiveTab('overdue')}
          id="tab-overdue"
        >
          Overdue <span className="tab-badge" style={{ color: '#dc2626' }}>{overdueTasks.length}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'completed' ? 'active' : ''}`}
          onClick={() => setActiveTab('completed')}
          id="tab-completed"
        >
          Completed <span className="tab-badge">{completedTasks.length}</span>
        </button>
      </div>

      {/* Tasks List Cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>Loading your tasks...</div>
      ) : displayedTasks.length === 0 ? (
        <div className="empty-state">
          <CheckCircle2 size={42} />
          <h3>No tasks in this view</h3>
          <p>Great job! You have no pending items under this filter.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
          {displayedTasks.map((task) => {
            const isOverdue = task.is_overdue;
            const isNoUpdate = task.is_no_update_alert;

            return (
              <div
                key={task.id}
                className="metric-card"
                style={{
                  cursor: 'default',
                  borderLeft: isOverdue
                    ? '4px solid #dc2626'
                    : isNoUpdate
                    ? '4px solid #d97706'
                    : '4px solid #3b82f6',
                  gap: '0.85rem'
                }}
                id={`emp-task-card-${task.id}`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span className="task-id-badge">{task.id}</span>
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    <span className={`badge badge-priority-${task.priority?.toLowerCase()}`}>
                      {task.priority}
                    </span>
                    <span className="badge badge-progress">{task.status}</span>
                  </div>
                </div>

                <div>
                  <h4
                    style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.25rem', cursor: 'pointer' }}
                    onClick={() => onSelectTask(task.id)}
                  >
                    {task.title}
                  </h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {task.instructions || task.description || 'No specific instructions provided.'}
                  </p>
                </div>

                {/* Progress Bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--text-muted)' }}>
                    <span>Progress</span>
                    <span>{task.progress_pct || 0}%</span>
                  </div>
                  <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${task.progress_pct || 0}%`,
                        height: '100%',
                        background: task.status === 'Completed' ? '#16a34a' : '#3b82f6',
                        transition: 'width 0.3s ease'
                      }}
                    />
                  </div>
                </div>

                {/* Inactivity & Deadline Metadata */}
                <div style={{ background: '#f8fafc', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b' }}>Deadline:</span>
                    <span style={{ fontWeight: 600, color: isOverdue ? '#dc2626' : '#1e293b' }}>
                      {new Date(task.deadline_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b' }}>Time Since Update:</span>
                    <span style={{ fontWeight: 600, color: isNoUpdate ? '#d97706' : '#1e293b' }}>
                      {task.hours_inactive} hours ago
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                  {task.status === 'New' && (
                    <button
                      className="btn-primary"
                      style={{ flex: 1, padding: '0.4rem', fontSize: '0.8rem' }}
                      onClick={() => handleQuickAcknowledge(task)}
                      id={`ack-btn-${task.id}`}
                    >
                      <CheckCircle size={14} /> Acknowledge
                    </button>
                  )}
                  <button
                    className="btn-primary"
                    style={{ flex: 1, padding: '0.4rem', fontSize: '0.8rem', background: '#0284c7' }}
                    onClick={() => onSelectTask(task.id)}
                    id={`update-progress-btn-${task.id}`}
                  >
                    <MessageSquare size={14} /> Log Progress & Remark
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ padding: '0.4rem 0.65rem' }}
                    onClick={() => onSelectTask(task.id)}
                    title="View Details"
                  >
                    <Eye size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
