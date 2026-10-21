import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const pool = createPool(loadConfig().databaseUrl);
try {
  await migrate(pool);
  console.log('Migrations up to date.');
} finally {
  await pool.end();
}
