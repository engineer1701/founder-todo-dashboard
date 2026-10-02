import React, { useState } from 'react';
import { X, Plus, Calendar, User, Clock, Bell, Paperclip } from 'lucide-react';

export default function CreateTaskModal({
  users,
  policies,
  onClose,
  onCreateTask
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [primaryAssigneeId, setPrimaryAssigneeId] = useState('');
  const [contributorIds, setContributorIds] = useState([]);
  const [priority, setPriority] = useState('Medium');
  
  // Default deadline 48 hours from now
  const defaultDeadline = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 16);
  const [deadlineAt, setDeadlineAt] = useState(defaultDeadline);
  const [reminderPolicyId, setReminderPolicyId] = useState(1);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [attachmentName, setAttachmentName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('Task title is required.');
      return;
    }
    if (!deadlineAt) {
      alert('Deadline is required.');
      return;
    }

    try {
      setSubmitting(true);
      const assigneeList = [];
      if (primaryAssigneeId) {
        assigneeList.push({ userId: parseInt(primaryAssigneeId, 10), responsibility: 'primary' });
      }
      for (const cid of contributorIds) {
        if (cid !== parseInt(primaryAssigneeId, 10)) {
          assigneeList.push({ userId: cid, responsibility: 'contributor' });
        }
      }

      await onCreateTask({
        title: title.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        primary_assignee_id: primaryAssigneeId ? parseInt(primaryAssigneeId, 10) : null,
        assignee_ids: assigneeList,
        priority,
        deadline_at: new Date(deadlineAt).toISOString(),
        reminder_policy_id: parseInt(reminderPolicyId, 10),
        email_notifications_enabled: emailNotifications ? 1 : 0,
        attachment_name: attachmentName.trim() || null
      });

      onClose();
    } catch (err) {
      alert('Failed to allocate task: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleContributor = (userId) => {
    if (contributorIds.includes(userId)) {
      setContributorIds(contributorIds.filter((id) => id !== userId));
    } else {
      setContributorIds([...contributorIds, userId]);
    }
  };

  const employeeUsers = users.filter((u) => u.role === 'employee');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Allocate New Task (Founder / Admin)</div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div className="modal-body form-grid">
            {/* Title */}
            <div className="form-group col-full">
              <label className="form-label">
                Task Title <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Collect 100 Customer Leads / Review Q4 Security Architecture"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                id="create-task-title"
              />
            </div>

            {/* Description */}
            <div className="form-group col-full">
              <label className="form-label">Objective & Description</label>
              <textarea
                className="form-textarea"
                placeholder="Describe the high-level business objective..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                id="create-task-desc"
              />
            </div>

            {/* Instructions */}
            <div className="form-group col-full">
              <label className="form-label">Step-by-Step Instructions / Acceptance Checklist</label>
              <textarea
                className="form-textarea"
                placeholder="1. Step one&#10;2. Step two&#10;3. Deliverable format..."
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                id="create-task-instructions"
              />
            </div>

            {/* Primary Assignee */}
            <div className="form-group">
              <label className="form-label">Primary Assignee</label>
              <select
                className="form-select-full"
                value={primaryAssigneeId}
                onChange={(e) => setPrimaryAssigneeId(e.target.value)}
                id="create-task-primary-assignee"
              >
                <option value="">Select Primary Owner...</option>
                {employeeUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.designation || u.department_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div className="form-group">
              <label className="form-label">Priority Level</label>
              <select
                className="form-select-full"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                id="create-task-priority"
              >
                <option value="Critical">Critical (Immediate Focus)</option>
                <option value="High">High Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="Low">Low Priority</option>
              </select>
            </div>

            {/* Deadline */}
            <div className="form-group">
              <label className="form-label">
                Scheduled Deadline (IST) <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                type="datetime-local"
                className="form-input"
                value={deadlineAt}
                onChange={(e) => setDeadlineAt(e.target.value)}
                required
                id="create-task-deadline"
              />
            </div>

            {/* Reminder Policy */}
            <div className="form-group">
              <label className="form-label">Follow-Up Policy (Reminder Engine)</label>
              <select
                className="form-select-full"
                value={reminderPolicyId}
                onChange={(e) => setReminderPolicyId(e.target.value)}
                id="create-task-policy"
              >
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.first_reminder_hours}h / {p.second_reminder_hours}h / {p.escalation_hours}h)
                  </option>
                ))}
              </select>
            </div>

            {/* Additional Contributors */}
            <div className="form-group col-full">
              <label className="form-label">Additional Contributors / Reviewers</label>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', background: '#f8fafc', padding: '0.65rem', borderRadius: 'var(--radius-md)' }}>
                {employeeUsers.map((u) => (
                  <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={contributorIds.includes(u.id)}
                      onChange={() => handleToggleContributor(u.id)}
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Attachments & Email Toggle */}
            <div className="form-group">
              <label className="form-label">Attachment / Spec File (Optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. lead_requirements_v1.pdf"
                value={attachmentName}
                onChange={(e) => setAttachmentName(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ justifyContent: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={emailNotifications}
                  onChange={(e) => setEmailNotifications(e.target.checked)}
                  id="create-task-email-toggle"
                />
                Send Automated Assignment & Inactivity Emails
              </label>
              <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                Employees will receive assignment link and scheduled follow-up alerts.
              </span>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting} id="create-task-submit-btn">
              {submitting ? 'Creating...' : 'Allocate Task & Notify'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
