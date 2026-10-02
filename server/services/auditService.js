const { db, getEffectiveNowISO } = require('../db/database');

function logAudit(taskId, actorUserId, action, metadata = {}) {
  const metaString = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
  const now = getEffectiveNowISO();

  const stmt = db.prepare(`
    INSERT INTO audit_logs (task_id, actor_user_id, action, metadata, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(taskId || null, actorUserId || null, action, metaString, now);
}

module.exports = {
  logAudit
};
