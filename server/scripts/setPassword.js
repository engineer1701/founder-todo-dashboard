require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('Password input requires an interactive terminal.'));
      return;
    }

    let value = '';
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    const onData = (buffer) => {
      for (const character of buffer.toString('utf8')) {
        if (character === '\u0003') {
          input.off('data', onData);
          input.setRawMode(false);
          process.stdout.write('\n');
          reject(new Error('Password entry cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          input.off('data', onData);
          input.setRawMode(false);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    input.on('data', onData);
  });
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run set-password -- <email>');

  const user = db.prepare("SELECT id, email FROM users WHERE lower(email) = ? AND status = 'active'").get(email);
  if (!user) throw new Error('Active user not found.');

  const password = await readSecret('New password: ');
  const confirmation = await readSecret('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password must be at least 12 characters and no more than 72 UTF-8 bytes.');
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hash, new Date().toISOString(), user.id);
  process.stdout.write(`Password set for ${user.email}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}).finally(() => db.close());