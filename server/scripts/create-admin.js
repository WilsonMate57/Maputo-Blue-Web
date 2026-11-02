// ─────────────────────────────────────────────────────────────────────────────
// create-admin.js — Makes one account THE super-administrator, who then creates
// the rest of the team in the panel (Equipa).
// Run on the server itself:  npm run create-admin -- owner@example.com "Full Name"
// - New account: with ADMIN_PASSWORD set, that is the password; without it, an
//   invitation e-mail is queued (link valid 72 h) to choose the password, which
//   suits Plesk's "Run script" (no terminal).
// - Existing account: promoted, password kept unless ADMIN_PASSWORD is given.
// - There is only one super-administrator: any other is moved to administrator
//   (sessions ended), and can then be given another level in Equipa.
// ─────────────────────────────────────────────────────────────────────────────
import { loadConfig } from '../src/config.js';
import { createPool, tx } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { hashPassword, passwordProblems } from '../src/lib/security.js';
import { NO_PASSWORD, sendStaffInvite } from '../src/lib/staff.js';

const [rawEmail, ...nameParts] = process.argv.slice(2);
if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail)) {
  console.error('Usage: npm run create-admin -- <email> "<name>"');
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();
const name = nameParts.join(' ').trim() || 'Administrador';
const password = process.env.ADMIN_PASSWORD || null;
if (password && passwordProblems(password)) {
  console.error('ADMIN_PASSWORD must be at least 10 characters.');
  process.exit(1);
}

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
const log = (c, id, action, data) => c.query(
  `insert into audit_log (actor_type, entity_type, entity_id, action, data) values ('system','user',$1,$2,$3)`,
  [id, action, JSON.stringify({ via: 'create-admin', ...data })]);
try {
  await migrate(pool, () => {});
  const hash = password ? await hashPassword(password) : null;
  await tx(pool, async c => {
    const { rows: [existing] } = await c.query('select id from users where lower(email) = $1 for update', [email]);
    let owner;
    if (existing) {
      ({ rows: [owner] } = await c.query(
        `update users set role = 'superadmin', email_verified_at = coalesce(email_verified_at, now()),
                password_hash = coalesce($2, password_hash), disabled_at = null, updated_at = now()
          where id = $1 returning id, email, name, role, password_hash`, [existing.id, hash]));
      await log(c, owner.id, 'promoted_to_admin', {});
      console.log(`✓ ${email} is now the super-administrator.`);
    } else {
      ({ rows: [owner] } = await c.query(
        `insert into users (email, password_hash, name, role, email_verified_at) values ($1,$2,$3,'superadmin', now())
         returning id, email, name, role, password_hash`, [email, hash || NO_PASSWORD, name]));
      await log(c, owner.id, 'admin_created', {});
      console.log(`✓ Super-administrator ${email} created.`);
    }
    if (owner.password_hash === NO_PASSWORD) {
      await sendStaffInvite(c, cfg, owner);
      console.log(`✓ Invitation e-mail queued for ${email}: open the link to choose the password (valid 72 hours).`);
    }
    const { rows: others } = await c.query(
      `update users set role = 'admin', updated_at = now() where role = 'superadmin' and id <> $1 returning id, email`, [owner.id]);
    for (const o of others) {
      await c.query('delete from sessions where user_id = $1', [o.id]);
      await log(c, o.id, 'access_changed', { role_before: 'superadmin', role_after: 'admin' });
      console.log(`✓ ${o.email} is now an administrator (change the level in Equipa if needed).`);
    }
  });
} finally {
  await pool.end();
}
