import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { backup } from '../src/lib/backup.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
try {
  const { dir, counts } = await backup(pool, cfg.siteRoot, process.argv[2] || 'manual');
  console.log(`Backup written to ${dir}`);
  console.table(counts);
} finally {
  await pool.end();
}
