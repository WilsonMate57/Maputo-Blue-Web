// ─────────────────────────────────────────────────────────────────────────────
// backup.js — Logical JSON backup of every table + a copy of data/*.json.
// Written to <site>/backups/<timestamp>/ (git-ignored). For full-fidelity
// production backups also schedule pg_dump (see docs/IMPLANTACAO.md).
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';

export async function backup(pool, siteRoot, label = 'manual') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(siteRoot, 'backups', `${stamp}-${label}`);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  const dataDir = path.join(siteRoot, 'data');
  for (const f of fs.readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
    fs.copyFileSync(path.join(dataDir, f), path.join(dir, 'data', f));
  }
  const { rows: tables } = await pool.query(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const counts = {};
  for (const { table_name } of tables) {
    if (table_name === 'sessions' || table_name === 'auth_tokens') continue; // secrets, short-lived
    const { rows } = await pool.query(`select * from "${table_name}"`);
    fs.writeFileSync(path.join(dir, `${table_name}.json`), JSON.stringify(rows, null, 1));
    counts[table_name] = rows.length;
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ created_at: new Date().toISOString(), label, counts }, null, 2));
  return { dir, counts };
}
