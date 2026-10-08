-- Seed data for Founder To-Do Allocation & Follow-Up Dashboard
-- Realistic company data reflecting Indian business timezone (Asia/Kolkata)

INSERT OR IGNORE INTO departments (id, name, status, created_at) VALUES
(1, 'Executive Office', 'active', '2026-09-01 09:00:00'),
(2, 'Human Resources & Talent', 'active', '2026-09-01 09:00:00'),
(3, 'Engineering & Architecture', 'active', '2026-09-01 09:00:00'),
(4, 'Growth & Marketing', 'active', '2026-09-01 09:00:00'),
(5, 'Customer Operations', 'active', '2026-09-01 09:00:00');

INSERT OR IGNORE INTO users (id, name, email, role, department_id, designation, avatar_url, status, created_at, updated_at) VALUES
(1, 'Vikram Singhania', 'vikram@company.internal', 'founder', 1, 'Founder & Managing Director', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&q=80', 'active', '2026-09-01 09:00:00', '2026-09-01 09:00:00'),
(2, 'Ananya Roy', 'ananya.roy@company.internal', 'admin', 1, 'Chief of Staff / Admin', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=160&q=80', 'active', '2026-09-01 09:00:00', '2026-09-01 09:00:00'),
(3, 'Rahul Sharma', 'rahul.sharma@company.internal', 'employee', 2, 'Senior HR Executive', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=160&q=80', 'active', '2026-09-01 09:00:00', '2026-09-01 09:00:00'),
(4, 'Priya Patel', 'priya.patel@company.internal', 'employee', 3, 'Lead Fullstack Engineer', 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=160&q=80', 'active', '2026-09-01 09:00:00', '2026-09-01 09:00:00'),
(5, 'Amit Verma', 'amit.verma@company.internal', 'employee', 4, 'Growth Marketing Lead', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&q=80', 'active', '2026-09-01 09:00:00', '2026-09-01 09:00:00'),
(6, 'Neha Gupta', 'neha.gupta@company.internal', 'employee', 5, 'Customer Success Manager', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=160&q=80', 'active', '2026-09-01 09:00:00', '2026-09-01 09:00:00');

INSERT OR IGNORE INTO reminder_policies (id, name, enabled, first_reminder_hours, second_reminder_hours, escalation_hours, deadline_reminder_hours, repeat_enabled, created_at, updated_at) VALUES
(1, 'Standard Founder Policy (24h / 48h / 72h)', 1, 24.0, 48.0, 72.0, 12.0, 1, '2026-09-01 09:00:00', '2026-09-01 09:00:00'),
(2, 'Urgent / High-Velocity (6h / 12h / 24h)', 1, 6.0, 12.0, 24.0, 4.0, 1, '2026-09-01 09:00:00', '2026-09-01 09:00:00'),
(3, 'Relaxed Executive (48h / 96h / 144h)', 1, 48.0, 96.0, 144.0, 24.0, 0, '2026-09-01 09:00:00', '2026-09-01 09:00:00');

INSERT OR IGNORE INTO email_templates (id, template_key, subject, body, enabled, updated_at) VALUES
(1, 'NEW_TASK_ASSIGNED', 'New Task Assigned: {{task_title}} [{{task_id}}]', '<p>Hi <strong>{{assignee_name}}</strong>,</p><p>A new task has been assigned to you by <strong>{{creator_name}}</strong>.</p><div style="background:#f4f5f7;padding:12px;border-left:4px solid #3b82f6;margin:16px 0;"><strong>{{task_title}}</strong><br/><p>{{description}}</p><p><strong>Priority:</strong> {{priority}} | <strong>Deadline:</strong> {{deadline}}</p></div><p>Please review and acknowledge the task:</p><p><a href="{{task_link}}" style="background:#2563eb;color:#ffffff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">Open Task in Dashboard</a></p>', 1, '2026-09-01 09:00:00'),
(2, 'ASSIGNMENT_CHANGED', 'Task Assignment Updated: {{task_title}} [{{task_id}}]', '<p>Hi <strong>{{assignee_name}}</strong>,</p><p>Your assignment for task <strong>{{task_title}}</strong> has been updated.</p><p><a href="{{task_link}}">View Task Details</a></p>', 1, '2026-09-01 09:00:00'),
(3, 'STATUS_UPDATE_REMINDER', 'Follow-up Alert: No status update on {{task_title}} for {{hours_inactive}} hours', '<p>Hi <strong>{{assignee_name}}</strong>,</p><p>This is an automated follow-up reminder. Task <strong>{{task_title}}</strong> has had no status or progress update for <strong>{{hours_inactive}} hours</strong>.</p><p>Management relies on real-time visibility. Please add a quick progress remark or change your status to reset reminders.</p><p><a href="{{task_link}}" style="background:#f59e0b;color:#ffffff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">Update Progress Now</a></p>', 1, '2026-09-01 09:00:00'),
(4, 'SECOND_REMINDER', 'Second Notice: Inactivity on {{task_title}} ({{hours_inactive}} hours pending)', '<p>Hi <strong>{{assignee_name}}</strong>,</p><p>We noticed there is still no update on <strong>{{task_title}}</strong> after <strong>{{hours_inactive}} hours</strong> of inactivity.</p><p>Please note that continued inactivity will automatically escalate this task to the Founder / Admin.</p><p><a href="{{task_link}}" style="background:#ea580c;color:#ffffff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">Submit Status Remark</a></p>', 1, '2026-09-01 09:00:00'),
(5, 'TASK_ESCALATED', 'ESCALATION ALERT: Task {{task_title}} inactive for {{hours_inactive}} hours', '<p>Dear <strong>{{recipient_name}}</strong>,</p><p><span style="color:#dc2626;font-weight:bold;">TASK ESCALATION:</span> Task <strong>{{task_title}}</strong> assigned to <strong>{{assignee_name}}</strong> has reached the inactivity escalation threshold of <strong>{{hours_inactive}} hours</strong> without any update.</p><p>Immediate managerial intervention is recommended.</p><p><a href="{{task_link}}" style="background:#dc2626;color:#ffffff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">Review Escalated Task</a></p>', 1, '2026-09-01 09:00:00'),
(6, 'DEADLINE_APPROACHING', 'Deadline Alert: {{task_title}} is due within {{hours_remaining}} hours', '<p>Hi <strong>{{assignee_name}}</strong>,</p><p>Reminder: The deadline for <strong>{{task_title}}</strong> is approaching on <strong>{{deadline}}</strong>.</p><p>Current Status: <strong>{{status}}</strong> ({{progress_pct}}% complete).</p><p><a href="{{task_link}}">View Task</a></p>', 1, '2026-09-01 09:00:00'),
(7, 'DEADLINE_REACHED', 'Deadline Reached: {{task_title}} [{{task_id}}]', '<p>Hi <strong>{{assignee_name}}</strong>,</p><p>The scheduled deadline for <strong>{{task_title}}</strong> has been reached today.</p><p><a href="{{task_link}}">Update Task Status</a></p>', 1, '2026-09-01 09:00:00'),
(8, 'OVERDUE', 'URGENT: Task Overdue - {{task_title}} [{{task_id}}]', '<p>Hi <strong>{{assignee_name}}</strong>,</p><p>Task <strong>{{task_title}}</strong> is now <strong>OVERDUE</strong>. Scheduled deadline was <strong>{{deadline}}</strong>.</p><p>Please update management with expected completion or request an extension.</p><p><a href="{{task_link}}" style="background:#ef4444;color:#white;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">Action Overdue Task</a></p>', 1, '2026-09-01 09:00:00'),
(9, 'TASK_COMPLETED', 'Task Completed: {{task_title}} by {{assignee_name}}', '<p>Hi <strong>{{recipient_name}}</strong>,</p><p>Task <strong>{{task_title}}</strong> has been marked as <strong>Completed</strong> by <strong>{{assignee_name}}</strong>.</p><p>Final Remark: <em>{{remark}}</em></p><p><a href="{{task_link}}">Review Task</a></p>', 1, '2026-09-01 09:00:00'),
(10, 'TASK_REOPENED', 'Task Reopened: {{task_title}} [{{task_id}}]', '<p>Hi <strong>{{assignee_name}}</strong>,</p><p>Task <strong>{{task_title}}</strong> has been reopened by management for rework.</p><p><a href="{{task_link}}">View Details</a></p>', 1, '2026-09-01 09:00:00'),
(11, 'TASK_REASSIGNED', 'Task Reassigned: {{task_title}} [{{task_id}}]', '<p>Hi <strong>{{assignee_name}}</strong>,</p><p>You have been assigned to <strong>{{task_title}}</strong>.</p><p><a href="{{task_link}}">View Task</a></p>', 1, '2026-09-01 09:00:00');

INSERT OR IGNORE INTO system_config (key, value, updated_at) VALUES
('business_timezone', 'Asia/Kolkata', '2026-09-01 09:00:00'),
('working_hours_start', '09:30', '2026-09-01 09:00:00'),
('working_hours_end', '18:30', '2026-09-01 09:00:00'),
('working_days', 'Mon,Tue,Wed,Thu,Fri', '2026-09-01 09:00:00'),
('app_base_url', 'http://localhost:5173', '2026-09-01 09:00:00'),
('simulated_now_offset_hours', '0', '2026-09-01 09:00:00');

UPDATE email_templates
SET body = replace(body, '{{task_link}}', '{{link}}')
WHERE instr(body, '{{task_link}}') > 0;
