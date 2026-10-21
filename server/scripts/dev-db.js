// ─────────────────────────────────────────────────────────────────────────────
// dev-db.js — Portable PostgreSQL 17 for local development (embedded-postgres).
// Data lives in server/.pgdata (git-ignored). Production uses a regular
// PostgreSQL service instead — see docs/DEPLOYMENT.md.
// Usage: npm run db:dev   (keeps running; Ctrl+C to stop)
// ─────────────────────────────────────────────────────────────────────────────
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.pgdata');
const port = Number(process.env.DEV_PG_PORT || 5433);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
for (const db of ['maputoblue', 'maputoblue_test']) {
  try { await pg.createDatabase(db); } catch { /* already exists */ }
}
console.log(`PostgreSQL dev server on 127.0.0.1:${port} (databases: maputoblue, maputoblue_test)`);

const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
