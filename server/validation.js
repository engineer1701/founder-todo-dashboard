const { z } = require('zod');

const stringField = (max = 10000) => z.string().max(max);
const positiveId = z.coerce.number().int().positive();
const statuses = [
  'New', 'Acknowledged', 'In Progress', 'Awaiting Information', 'On Hold',
  'Submitted for Review', 'Rework Required', 'Completed', 'Approved', 'Cancelled'
];
const roleTypes = ['primary', 'contributor', 'reviewer'];
const assignee = z.union([
  positiveId,
  z.object({ userId: positiveId, responsibility: z.enum(roleTypes).optional() })
]);
const boolOrInt = z.union([z.boolean(), z.number().int().min(0).max(1)]);

const schemas = {
  login: z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) }),
  devLogin: z.object({ user_id: positiveId }),
  empty: z.object({}),
  taskCreate: z.object({
    title: z.string().trim().min(1).max(200),
    deadline_at: z.string().min(1).max(100),
    description: stringField().optional(),
    instructions: stringField().optional(),
    priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional(),
    start_at: z.string().max(100).optional(),
    assignee_ids: z.array(assignee).max(100).optional(),
    primary_assignee_id: positiveId.nullable().optional(),
    reminder_policy_id: positiveId.optional(),
    email_notifications_enabled: boolOrInt.optional(),
    recurrence_rule: z.string().max(500).nullable().optional(),
    attachment_name: z.string().max(255).nullable().optional()
  }),
  taskUpdate: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: stringField().optional(),
    instructions: stringField().optional(),
    priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional(),
    start_at: z.string().max(100).optional(),
    deadline_at: z.string().min(1).max(100).optional(),
    reminder_policy_id: positiveId.optional(),
    email_notifications_enabled: boolOrInt.optional(),
    status: z.enum(statuses).optional()
  }),
  assign: z.object({
    assignee_ids: z.array(assignee).max(100).optional(),
    primary_user_id: positiveId.optional()
  }),
  status: z.object({
    status: z.enum(statuses).optional(),
    remark: z.string().trim().min(1).max(5000),
    progress_pct: z.coerce.number().int().min(0).max(100).optional()
  }),
  comment: z.object({ comment: z.string().trim().min(1).max(5000) }),
  remind: z.object({ message: z.string().max(2000).optional() }),
  attachment: z.object({
    file_name: z.string().trim().min(1).max(255),
    file_url: z.string().max(2000).optional(),
    file_size: z.coerce.number().int().nonnegative().optional(),
    file_type: z.string().max(255).optional()
  }),
  reminderSettings: z.object({
    policy_id: positiveId,
    first_reminder_hours: z.coerce.number().finite().nonnegative().optional(),
    second_reminder_hours: z.coerce.number().finite().nonnegative().optional(),
    escalation_hours: z.coerce.number().finite().nonnegative().optional(),
    deadline_reminder_hours: z.coerce.number().finite().nonnegative().optional(),
    repeat_enabled: boolOrInt.optional(),
    enabled: boolOrInt.optional()
  }),
  template: z.object({
    subject: z.string().max(500).optional(),
    body: stringField().optional(),
    enabled: boolOrInt.optional()
  }),
  config: z.object({
    config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  }),
  simulateTime: z.object({
    advance_hours: z.coerce.number().finite().optional(),
    reset: z.boolean().optional()
  })
};

module.exports = { schemas };