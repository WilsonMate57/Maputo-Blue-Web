// ─────────────────────────────────────────────────────────────────────────────
// import-firestore-reviews.js — One-off migration of the public "reviews"
// collection from Firestore (project maputo-blue-web) into PostgreSQL.
// Reads through the public REST API (the collection is publicly readable),
// saves a raw JSON copy to backups/, and is idempotent (legacy_id unique).
// Usage: npm run import:reviews [-- --dry-run]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'maputo-blue-web';
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyC2xFXyIK_jZNUZLw0rPoTO_A0XbZW0tgQ'; // public web key already in the site
const dry = process.argv.includes('--dry-run');
const cfg = loadConfig();

const val = f => f && (f.stringValue ?? (f.integerValue !== undefined ? Number(f.integerValue) : undefined) ??
  f.doubleValue ?? f.timestampValue ?? f.booleanValue ?? null);

async function fetchAll() {
  const docs = [];
  let pageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/reviews?pageSize=300&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore ${res.status}: ${await res.text()}`);
    const body = await res.json();
    docs.push(...(body.documents || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return docs;
}

const docs = await fetchAll();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(cfg.siteRoot, 'backups', `${stamp}-firestore-reviews`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'reviews.raw.json'), JSON.stringify(docs, null, 1));
console.log(`Fetched ${docs.length} review(s) from Firestore → ${dir}`);

const rows = [], problems = [];
for (const d of docs) {
  const f = d.fields || {};
  const r = {
    legacy_id: d.name.split('/').pop(),
    package_id: val(f.packageId), name: String(val(f.name) || '').slice(0, 80), rating: Number(val(f.rating)),
    comment: String(val(f.comment) || '').slice(0, 1000), created_at: val(f.createdAt) || d.createTime,
  };
  if (!r.package_id || !r.name || !(r.rating >= 1 && r.rating <= 5) || !r.comment) { problems.push({ id: r.legacy_id, r }); continue; }
  rows.push(r);
}
if (problems.length) console.log(`Skipped ${problems.length} malformed review(s):`, problems.map(p => p.id).join(', '));
if (dry) console.log(`Dry run — ${rows.length} review(s) would be imported.`);
else await save();

async function save() {
  const pool = createPool(cfg.databaseUrl);
  try {
    await migrate(pool, () => {});
    let inserted = 0;
    for (const r of rows) {
      const res = await pool.query(
        `insert into reviews (package_id, name, rating, comment, created_at, source, legacy_id)
         values ($1,$2,$3,$4,$5,'firestore',$6) on conflict (legacy_id) do nothing`,
        [r.package_id, r.name, Math.round(r.rating), r.comment, r.created_at, r.legacy_id]);
      inserted += res.rowCount;
    }
    const { rows: [{ n }] } = await pool.query(`select count(*)::int n from reviews where source = 'firestore'`);
    console.log(`Inserted ${inserted} new review(s); ${n} Firestore review(s) now in PostgreSQL (Firestore total: ${docs.length}, malformed: ${problems.length}).`);
  } finally {
    await pool.end();
  }
}
