WITH ranked_reminders AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY task_id, recipient_user_id, reminder_type, cycle_id
           ORDER BY CASE status WHEN 'sent' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
                    COALESCE(sent_at, scheduled_at) DESC,
                    id DESC
         ) AS row_number
  FROM task_reminders
  WHERE cycle_id IS NOT NULL
)
DELETE FROM task_reminders
WHERE cycle_id IS NOT NULL
  AND id IN (SELECT id FROM ranked_reminders WHERE row_number > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_reminders_cycle_unique
ON task_reminders (task_id, recipient_user_id, reminder_type, cycle_id);