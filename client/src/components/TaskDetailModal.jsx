import React, { useState, useEffect } from 'react';
import {
  X,
  Clock,
  AlertTriangle,
  User,
  Calendar,
  Send,
  MessageSquare,
  FileText,
  History,
  ShieldAlert,
  Paperclip,
  CheckCircle,
  ExternalLink,
  Flame,
  Check
} from 'lucide-react';

export default function TaskDetailModal({
  taskId,
  currentUser,
  users,
  onClose,
  onUpdateStatus,
  onAddComment,
  onAddAttachment,
  onManualRemind,
  onReassign
}) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview'); // overview, updates, comments, reminders, audit, files
  const [error, setError] = useState(null);

  // Status update form state
  const [newStatus, setNewStatus] = useState('');
  const [newProgress, setNewProgress] = useState(0);
  const [newRemark, setNewRemark] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Comment input state
  const [commentText, setCommentText] = useState('');
  const [addingComment, setAddingComment] = useState(false);

  // Reassign state
  const [showReassign, setShowReassign] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState('');

  // Fetch full task detail
  const fetchDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/tasks/${taskId}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const error = new Error(data.error?.message || data.error || 'Failed to load task details');
        error.status = res.status;
        throw error;
      }
      setTask(data.task);
      setNewStatus(data.task.status);
      setNewProgress(data.task.progress_pct || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (taskId) {
      fetchDetail();
    }
  }, [taskId, currentUser?.id]);

  const handleStatusSubmit = async (e) => {
    e.preventDefault();
    if (!newRemark.trim()) {
      alert('A progress remark is required to record this update and reset the inactivity timer.');
      return;
    }
    try {
      setUpdatingStatus(true);
      await onUpdateStatus(taskId, newStatus, newRemark.trim(), newProgress);
      setNewRemark('');
      await fetchDetail();
    } catch (err) {
      alert('Error updating status: ' + err.message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    try {
      setAddingComment(true);
      await onAddComment(taskId, commentText.trim());
      setCommentText('');
      await fetchDetail();
    } catch (err) {
      alert('Error adding comment: ' + err.message);
    } finally {
      setAddingComment(false);
    }
  };

  const handleReassignSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAssignee) return;
    try {
      await onReassign(taskId, [parseInt(selectedAssignee, 10)], parseInt(selectedAssignee, 10));
      setShowReassign(false);
      await fetchDetail();
    } catch (err) {
      alert('Error reassigning: ' + err.message);
    }
  };

  const isFounderOrAdmin = currentUser?.role === 'founder' || currentUser?.role === 'admin';

  if (!taskId) return null;

  if (error?.status === 403) {
    return (
      <main className="access-denied-page">
        <section>
          <h1>Access denied</h1>
          <p>You are not assigned to task {taskId}.</p>
          <button className="btn-primary" onClick={onClose}>Return to my tasks</button>
        </section>
      </main>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '850px' }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span className="task-id-badge">{taskId}</span>
            <span className="modal-title" style={{ fontSize: '1.1rem' }}>
              {task?.title || 'Task Details'}
            </span>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>Loading task records...</div>
        ) : error ? (
          <div style={{ padding: '2rem', color: '#dc2626' }}>
            <h4>Unable to access task</h4>
            <p>{error}</p>
          </div>
        ) : task ? (
          <div className="modal-body">
            {/* Top Quick Status & Urgent Notice */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <span className={`badge badge-priority-${task.priority?.toLowerCase()}`}>
                  Priority: {task.priority}
                </span>
                <span className="badge badge-progress">Status: {task.status}</span>
                {task.is_overdue && (
                  <span className="badge badge-overdue">⚠️ OVERDUE</span>
                )}
                {task.is_no_update_alert && (
                  <span className="inactivity-warning-pill">
                    <Clock size={12} /> {task.hours_inactive}h Inactive
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {isFounderOrAdmin && (
                  <>
                    <button
                      className="btn-secondary"
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      onClick={() => onManualRemind(task.id)}
                      id="modal-nudge-btn"
                    >
                      <Send size={12} /> Nudge Assignee
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      onClick={() => setShowReassign(!showReassign)}
                    >
                      Reassign
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Reassign Form if toggled */}
            {showReassign && (
              <form onSubmit={handleReassignSubmit} style={{ background: '#f1f5f9', padding: '0.85rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Reassign to:</span>
                <select
                  className="filter-select"
                  value={selectedAssignee}
                  onChange={(e) => setSelectedAssignee(e.target.value)}
                  style={{ flex: 1 }}
                >
                  <option value="">Select Employee...</option>
                  {users.filter(u => u.role === 'employee').map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.designation})</option>
                  ))}
                </select>
                <button type="submit" className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                  Save Assignee
                </button>
              </form>
            )}

            {/* Inactivity reset notice */}
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: '#166534', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={16} />
              <span>
                <strong>Inactivity Engine:</strong> Last update was logged {task.hours_inactive} hours ago. Submitting a new progress update below will immediately reset the follow-up timer.
              </span>
            </div>

            {/* Status & Progress Update Drawer Form */}
            <div style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1.25rem' }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle size={16} color="#2563eb" /> Log Status & Progress Remark
              </h4>
              <form onSubmit={handleStatusSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label className="form-label">Update Status</label>
                    <select
                      className="form-select-full"
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      id="update-status-select"
                    >
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
                  </div>
                  <div>
                    <label className="form-label">Progress: {newProgress}%</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={newProgress}
                      onChange={(e) => setNewProgress(parseInt(e.target.value, 10))}
                      style={{ width: '100%', marginTop: '0.5rem', cursor: 'pointer' }}
                      id="progress-slider"
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">
                    Progress Remark <span style={{ color: '#dc2626' }}>*</span> (Resets Inactivity Timer)
                  </label>
                  <textarea
                    className="form-textarea"
                    placeholder="Provide specific notes on what was accomplished or blockers encountered..."
                    value={newRemark}
                    onChange={(e) => setNewRemark(e.target.value)}
                    required
                    style={{ minHeight: '60px' }}
                    id="update-remark-input"
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={updatingStatus}
                    id="submit-status-update-btn"
                  >
                    {updatingStatus ? 'Recording...' : 'Submit Progress Update & Reset Timer'}
                  </button>
                </div>
              </form>
            </div>

            {/* Inner Sub-Navigation Tabs */}
            <div className="tabs-container" style={{ margin: '1rem 0 1rem 0' }}>
              <button
                className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
                style={{ fontSize: '0.85rem' }}
              >
                Overview & Instructions
              </button>

              <button
                className={`tab-btn ${activeTab === 'updates' ? 'active' : ''}`}
                onClick={() => setActiveTab('updates')}
                style={{ fontSize: '0.85rem' }}
              >
                Status History ({task.updates?.length || 0})
              </button>

              <button
                className={`tab-btn ${activeTab === 'comments' ? 'active' : ''}`}
                onClick={() => setActiveTab('comments')}
                style={{ fontSize: '0.85rem' }}
              >
                Comments ({task.comments?.length || 0})
              </button>

              <button
                className={`tab-btn ${activeTab === 'reminders' ? 'active' : ''}`}
                onClick={() => setActiveTab('reminders')}
                style={{ fontSize: '0.85rem' }}
              >
                Reminder Logs ({task.reminders?.length || 0})
              </button>

              <button
                className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
                onClick={() => setActiveTab('audit')}
                style={{ fontSize: '0.85rem' }}
              >
                Audit Trail ({task.auditTrail?.length || 0})
              </button>
            </div>

            {/* TAB 1: OVERVIEW */}
            {activeTab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.875rem' }}>
                <div>
                  <h5 style={{ fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>Description</h5>
                  <p style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 'var(--radius-sm)', lineHeight: 1.5 }}>
                    {task.description || 'No description entered.'}
                  </p>
                </div>

                <div>
                  <h5 style={{ fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>Instructions / Scope of Work</h5>
                  <pre style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.5 }}>
                    {task.instructions || 'No special instructions.'}
                  </pre>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', background: '#f8fafc', padding: '0.85rem', borderRadius: 'var(--radius-md)' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Scheduled Deadline</span>
                    <div style={{ fontWeight: 600 }}>
                      {new Date(task.deadline_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Reminder Policy</span>
                    <div style={{ fontWeight: 600 }}>{task.policy_name || 'Standard Founder Policy (24h/48h/72h)'}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Created By</span>
                    <div style={{ fontWeight: 600 }}>{task.creator_name || 'Founder'}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Primary Assignee</span>
                    <div style={{ fontWeight: 600 }}>{task.primary_assignee?.name || 'Unassigned'}</div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: STATUS & PROGRESS HISTORY */}
            {activeTab === 'updates' && (
              <div className="timeline-list">
                {task.updates?.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No status updates recorded yet.</div>
                ) : (
                  task.updates?.map((u) => (
                    <div key={u.id} className="timeline-item">
                      <div className="timeline-dot" />
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <strong>{u.user_name}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(u.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', fontSize: '0.8rem' }}>
                        <span className="badge badge-hold">{u.old_status || 'New'}</span>
                        <span>→</span>
                        <span className="badge badge-progress">{u.new_status}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>Progress: {u.progress_pct}%</span>
                      </div>
                      <p style={{ fontStyle: 'italic', background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)' }}>
                        "{u.remark}"
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 3: COMMENTS */}
            {activeTab === 'comments' && (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem', maxHeight: '250px', overflowY: 'auto' }}>
                  {task.comments?.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No comments yet. Start the conversation below.</div>
                  ) : (
                    task.comments?.map((c) => (
                      <div key={c.id} style={{ background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{c.user_name}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {new Date(c.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>{c.comment}</p>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleCommentSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Type a comment or instruction..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    style={{ flex: 1 }}
                    id="task-comment-input"
                  />
                  <button type="submit" className="btn-primary" disabled={addingComment} id="send-comment-btn">
                    <Send size={14} /> Send
                  </button>
                </form>
              </div>
            )}

            {/* TAB 4: REMINDER LOGS */}
            {activeTab === 'reminders' && (
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Automated Reminder & Escalation Dispatch History (Section 9 & 10 Idempotency Record):
                </p>
                {task.reminders?.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No automated reminders dispatched for this task yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {task.reminders?.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid var(--border-subtle)',
                          padding: '0.6rem 0.85rem',
                          borderRadius: 'var(--radius-sm)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span className="badge badge-hold" style={{ fontWeight: 700 }}>
                              {r.reminder_type}
                            </span>
                            <span style={{ fontSize: '0.8rem' }}>Recipient: {r.recipient_name} ({r.recipient_email})</span>
                          </div>
                          {r.metadata && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                              Details: {r.metadata}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <div>Status: <strong style={{ color: '#16a34a' }}>{r.status}</strong></div>
                          <div>{new Date(r.sent_at || r.scheduled_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: AUDIT TRAIL */}
            {activeTab === 'audit' && (
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {task.auditTrail?.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      padding: '0.5rem 0',
                      fontSize: '0.8rem',
                      display: 'flex',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <strong>{a.action}</strong> {a.actor_name ? `by ${a.actor_name}` : ''}
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{a.metadata}</div>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                      {new Date(a.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
