const fs = require('node:fs');
const path = require('node:path');

const migrationsPath = path.join(__dirname, 'migrations');
const schemaPath = path.join(__dirname, 'schema.sql');

function applyMigration(db, version, sql) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(version, new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
  if (!applied.get('000_baseline')) {
    applyMigration(db, '000_baseline', fs.readFileSync(schemaPath, 'utf8'));
  }

  const files = fs.readdirSync(migrationsPath)
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/i.test(file))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/i, '');
    if (applied.get(version)) continue;
    applyMigration(db, version, fs.readFileSync(path.join(migrationsPath, file), 'utf8'));
  }
}

module.exports = { runMigrations };