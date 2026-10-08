const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');
const envPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: envPath });
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');

const email = '24ad442@mgits.ac.in';
const envValues = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};

async function main() {
  const useProcessPassword = process.argv.includes('--allow-process-password');
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
  if (existing) {
    process.stdout.write(`User ${email} already exists; no changes made.\n`);
    return;
  }

  const password = useProcessPassword
    ? process.env.DEMO_USERS_PASSWORD
    : envValues.DEMO_USERS_PASSWORD;
  if (!password) {
    throw new Error('Set DEMO_USERS_PASSWORD in .env before adding this account.');
  }
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('DEMO_USERS_PASSWORD must be at least 12 characters and no more than 72 UTF-8 bytes.');
  }

  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, 12);
  const result = db.prepare(`
    INSERT OR IGNORE INTO users (
      name, email, role, status, created_at, updated_at, password_hash
    ) VALUES (?, ?, 'employee', 'active', ?, ?, ?)
  `).run('Test Employee (MGITS)', email, now, now, passwordHash);

  if (result.changes) {
    process.stdout.write(`Added active employee ${email}.\n`);
  } else {
    process.stdout.write(`User ${email} already exists; no changes made.\n`);
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.close());