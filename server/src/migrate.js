// ─────────────────────────────────────────────────────────────────────────────
// migrate.js — Applies numbered SQL files from server/migrations in order.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(pool, log = console.log) {
  const enc = await pool.query('show server_encoding');
  if (enc.rows[0].server_encoding !== 'UTF8') {
    throw new Error(`Database must use UTF8 encoding (found ${enc.rows[0].server_encoding}). ` +
      `Create it with: CREATE DATABASE maputoblue ENCODING 'UTF8' TEMPLATE template0;`);
  }
  await pool.query(`create table if not exists schema_migrations (
    version text primary key, applied_at timestamptz not null default now())`);
  const { rows } = await pool.query('select version from schema_migrations');
  const done = new Set(rows.map(r => r.version));
  const files = (await fs.readdir(DIR)).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (version) values ($1)', [file]);
      await client.query('commit');
      log(`  ✓ migration ${file}`);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
}
