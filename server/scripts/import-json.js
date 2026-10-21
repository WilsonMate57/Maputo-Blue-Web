// Usage: npm run import:json -- [--dry-run] [--force]
//   --dry-run  validate and report only
//   --force    replace packages that already exist (content + pricing)
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { backup } from '../src/lib/backup.js';
import { planImport, runImport } from '../src/lib/importer.js';

const args = new Set(process.argv.slice(2));
const cfg = loadConfig();
const plan = planImport(cfg.siteRoot);

console.log(`\nValidated ${plan.records.length} record(s): ` +
  `${plan.records.filter(r => r.kind === 'tour').length} tours, ${plan.records.filter(r => r.kind === 'accommodation').length} accommodations`);
if (plan.errors.length) { console.log('\nERRORS:'); plan.errors.forEach(e => console.log('  ✗ ' + e)); }
if (plan.warnings.length) { console.log('\nWARNINGS:'); plan.warnings.forEach(w => console.log('  ! ' + w)); }
if (plan.errors.length) process.exit(1);
if (args.has('--dry-run')) { console.log('\nDry run — nothing written.'); process.exit(0); }

const pool = createPool(cfg.databaseUrl);
try {
  await migrate(pool);
  const { dir } = await backup(pool, cfg.siteRoot, 'pre-import');
  console.log(`\nBackup: ${dir}`);
  const res = await runImport(pool, plan, { force: args.has('--force'), log: console.log });
  const { rows } = await pool.query(`select kind, count(*)::int n from packages group by kind`);
  const report = { ...res, warnings: plan.warnings, db_counts: rows };
  fs.writeFileSync(path.join(dir, 'import-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nInserted ${res.inserted.length}, replaced ${res.replaced.length}, skipped (already present) ${res.skipped.length}`);
  console.log('Packages in database:', rows.map(r => `${r.kind}=${r.n}`).join(', '));
} finally {
  await pool.end();
}
