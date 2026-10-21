// ─────────────────────────────────────────────────────────────────────────────
// db.js — PostgreSQL pool and transaction helper.
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings (no timezone shifting)
pg.types.setTypeParser(1082, v => v);
// NUMERIC → JS number (amounts are stored with 2 decimals)
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/** Run fn(client) inside a transaction; rolls back on error. */
export async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
