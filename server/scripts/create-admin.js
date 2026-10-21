// ─────────────────────────────────────────────────────────────────────────────
// create-admin.js — The only way to create the first administrator.
// Run on the server itself:  npm run create-admin -- admin@example.com "Full Name"
// The password is read from the ADMIN_PASSWORD environment variable or prompted.
// An existing account with that e-mail is promoted to admin (password kept
// unless ADMIN_PASSWORD is given).
// ─────────────────────────────────────────────────────────────────────────────
import readline from 'node:readline/promises';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { hashPassword, passwordProblems } from '../src/lib/security.js';

const [email, ...nameParts] = process.argv.slice(2);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error('Usage: npm run create-admin -- <email> "<name>"');
  process.exit(1);
}
const name = nameParts.join(' ') || 'Administrador';

async function askPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question('Password (min. 10 characters): ');
  rl.close();
  return pw;
}

const pool = createPool(loadConfig().databaseUrl);
try {
  await migrate(pool, () => {});
  const { rows: [existing] } = await pool.query('select id from users where lower(email) = lower($1)', [email]);
  let password = null;
  if (!existing || process.env.ADMIN_PASSWORD) {
    password = await askPassword();
    const problem = passwordProblems(password);
    if (problem) { console.error('Password must be at least 10 characters.'); process.exit(1); }
  }
  if (existing) {
    await pool.query(`update users set role='admin', email_verified_at=coalesce(email_verified_at, now()),
                      password_hash = coalesce($2, password_hash), disabled_at = null, updated_at=now() where id=$1`,
      [existing.id, password ? await hashPassword(password) : null]);
    await pool.query(`insert into audit_log (actor_type, entity_type, entity_id, action, data) values ('system','user',$1,'promoted_to_admin','{"via":"create-admin"}')`, [existing.id]);
    console.log(`✓ ${email} is now an administrator.`);
  } else {
    const { rows: [u] } = await pool.query(
      `insert into users (email, password_hash, name, role, email_verified_at) values ($1,$2,$3,'admin', now()) returning id`,
      [email.toLowerCase(), await hashPassword(password), name]);
    await pool.query(`insert into audit_log (actor_type, entity_type, entity_id, action, data) values ('system','user',$1,'admin_created','{"via":"create-admin"}')`, [u.id]);
    console.log(`✓ Administrator ${email} created.`);
  }
} finally {
  await pool.end();
}
