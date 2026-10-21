// ─────────────────────────────────────────────────────────────────────────────
// importer.js — Controlled import of data/tours.json + data/accommodations.json
// into PostgreSQL. Validates first, never overwrites existing packages unless
// explicitly forced, and keeps the original JSON record in revision #1.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { LEGACY_PRICE_FIELDS, pricingFromLegacy } from './pricing-model.js';
import { validateAvailability } from './availability.js';
import { tx } from '../db.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error(`${path.basename(file)} must contain an array`);
  return data;
}

/** Resolve a '../assets/...' image path (as used from /pages/) to a disk path. */
function imageOnDisk(siteRoot, src) {
  if (typeof src !== 'string' || /^https?:/i.test(src)) return null;
  return path.join(siteRoot, src.replace(/^(\.\.\/|\.\/|\/)+/, ''));
}

/** Validate both files and build the records to import. No database access. */
export function planImport(siteRoot) {
  const report = { errors: [], warnings: [], records: [] };
  const sources = [
    { file: path.join(siteRoot, 'data', 'tours.json'), kind: 'tour' },
    { file: path.join(siteRoot, 'data', 'accommodations.json'), kind: 'accommodation' },
  ];
  const seen = new Map();
  for (const { file, kind } of sources) {
    let items;
    try { items = readJson(file); } catch (e) { report.errors.push(`${path.basename(file)}: ${e.message}`); continue; }
    items.forEach((item, index) => {
      const where = `${path.basename(file)}[${index}]`;
      if (!item || typeof item !== 'object') { report.errors.push(`${where}: not an object`); return; }
      if (!ID_RE.test(item.id || '')) { report.errors.push(`${where}: invalid id "${item.id}"`); return; }
      if (seen.has(item.id)) { report.errors.push(`${where}: duplicate id "${item.id}" (also in ${seen.get(item.id)})`); return; }
      seen.set(item.id, where);
      if (!item.category) report.errors.push(`${where} (${item.id}): missing category`);
      if (!(item.title || item.name)) report.errors.push(`${where} (${item.id}): missing title/name`);

      for (const src of [item.cover, ...(item.images || [])].filter(Boolean)) {
        const p = imageOnDisk(siteRoot, src);
        if (p && !fs.existsSync(p)) report.warnings.push(`${item.id}: image not found on disk: ${src}`);
      }
      if (!item.images || !item.images.length) report.warnings.push(`${item.id}: no gallery images`);

      let priced;
      try { priced = pricingFromLegacy(item, kind); } catch (e) {
        report.errors.push(`${item.id}: pricing — ${(e.details || [e.message]).join('; ')}`); return;
      }
      priced.notes.forEach(n => report.warnings.push(`${item.id}: ${n}`));

      const content = { ...item };
      for (const f of LEGACY_PRICE_FIELDS) delete content[f];
      delete content.id; delete content.category;

      const perGroup = priced.pricing.unit === 'per_group';
      const availability = validateAvailability(kind === 'accommodation'
        ? { unit: 'room', occupancy: (item.rooms && item.rooms[0] && item.rooms[0].capacity) || 2, default_capacity: null }
        : { unit: perGroup ? 'unit' : 'pax', per_option: priced.pricing.options.length > 0, default_capacity: null });

      report.records.push({
        id: item.id, kind, category: item.category, sort_order: index,
        content, pricing: priced.pricing, rules: priced.rules, availability, source: item,
      });
    });
  }
  return report;
}

/**
 * Write the planned records. Existing ids are skipped unless force=true
 * (force replaces content/pricing but keeps bookings, reviews and day overrides).
 */
export async function runImport(pool, plan, { force = false, log = () => {} } = {}) {
  if (plan.errors.length) throw new Error(`Import aborted: ${plan.errors.length} validation error(s)`);
  const result = { inserted: [], replaced: [], skipped: [] };
  await tx(pool, async c => {
    for (const r of plan.records) {
      const exists = (await c.query('select version from packages where id = $1 for update', [r.id])).rows[0];
      if (exists && !force) { result.skipped.push(r.id); continue; }
      if (exists) {
        await c.query(
          `update packages set kind=$2, category=$3, content=$4, pricing=$5, availability=$6, sort_order=$7,
                  version=version+1, updated_at=now() where id=$1`,
          [r.id, r.kind, r.category, r.content, r.pricing, r.availability, r.sort_order]);
        await c.query('delete from price_rules where package_id = $1', [r.id]);
        result.replaced.push(r.id);
      } else {
        await c.query(
          `insert into packages (id, kind, category, status, content, pricing, availability, sort_order)
           values ($1,$2,$3,'published',$4,$5,$6,$7)`,
          [r.id, r.kind, r.category, r.content, r.pricing, r.availability, r.sort_order]);
        result.inserted.push(r.id);
      }
      for (const rule of r.rules) {
        await c.query(
          `insert into price_rules (package_id, label, weekdays, adult, child, priority) values ($1,$2,$3,$4,$5,$6)`,
          [r.id, rule.label, rule.weekdays, rule.adult, rule.child, rule.priority]);
      }
      // Full snapshot (restorable from the dashboard) + the original JSON record
      const { rows: [p] } = await c.query('select * from packages where id = $1', [r.id]);
      await c.query('insert into package_revisions (package_id, version, snapshot) values ($1,$2,$3)', [r.id, p.version, {
        via: exists ? 'import --force' : 'import', status: p.status, category: p.category, featured: p.featured, promotional: p.promotional,
        sort_order: p.sort_order, content: p.content, pricing: p.pricing, availability: p.availability, seo: p.seo,
        rules: r.rules.map(x => ({ ...x, date_from: null, date_to: null, option_key: null, active: true })), source: r.source,
      }]);
      log(`  ${exists ? '↻' : '+'} ${r.id}`);
    }
    await c.query(
      `insert into audit_log (actor_type, entity_type, entity_id, action, data) values ('system','catalog','import','import',$1)`,
      [{ inserted: result.inserted.length, replaced: result.replaced.length, skipped: result.skipped.length }]);
  });
  return result;
}
