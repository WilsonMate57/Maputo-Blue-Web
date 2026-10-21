// ─────────────────────────────────────────────────────────────────────────────
// catalog.js — Package data access and the public representation.
// Public records keep the exact shape of the original data/*.json files
// (plus a `booking` block) so the existing renderers keep working.
// ─────────────────────────────────────────────────────────────────────────────
import { legacyPriceFields } from './pricing-model.js';
import { notFound } from './errors.js';

const DEFAULT_SETTINGS = {
  booking: { pending_holds_capacity: true, pending_hold_hours: 48, auto_complete: true, min_lead_hours: 24, max_advance_days: 365 },
  loyalty: { enabled: false },
  notifications: { admin_emails: [] },
};

export async function getSetting(db, key) {
  const { rows } = await db.query('select value from settings where key = $1', [key]);
  return { ...(DEFAULT_SETTINGS[key] || {}), ...(rows[0] ? rows[0].value : {}) };
}

export async function loadRules(db, packageIds) {
  const { rows } = await db.query(
    `select id::int, package_id, label, date_from, date_to, weekdays, option_key, adult, child, priority, active
       from price_rules where package_id = any($1) and active order by id`, [packageIds]);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.package_id)) map.set(r.package_id, []);
    map.get(r.package_id).push(r);
  }
  return map;
}

/** Load one package with its price rules. */
export async function loadPackage(db, id, { publishedOnly = false } = {}) {
  const { rows } = await db.query(
    `select * from packages where id = $1 ${publishedOnly ? "and status = 'published'" : ''}`, [id]);
  if (!rows[0]) throw notFound('package_not_found', 'Package not found');
  const rules = (await loadRules(db, [id])).get(id) || [];
  return { pkg: rows[0], rules };
}

async function ratingMap(db, ids) {
  const { rows } = await db.query(
    `select package_id, round(avg(rating)::numeric, 1)::float as avg, count(*)::int as count
       from reviews where status = 'published' and package_id = any($1) group by package_id`, [ids]);
  return new Map(rows.map(r => [r.package_id, r]));
}

/** Public JSON for a package (legacy shape + booking configuration). */
export function publicRecord(pkg, rules, rating) {
  const c = pkg.content || {};
  const p = pkg.pricing;
  const rec = {
    ...c,
    id: pkg.id,
    category: pkg.category,
    ...legacyPriceFields(pkg, rules),
    featured: pkg.featured,
    promotional: pkg.promotional,
    booking: {
      kind: pkg.kind,
      unit: p.unit,
      nights: p.nights,
      child: p.child,
      options: p.options.filter(o => o.active !== false).map(o => ({
        key: o.key, name: o.name, name_en: o.name_en, price: o.price, max_pax: o.max_pax || null,
        capacity_text: o.capacity_text || '', capacity_text_en: o.capacity_text_en || '',
      })),
      option_required: p.option_required,
      extras: p.extras.filter(e => e.active !== false).map(({ key, name, name_en, price, per }) => ({ key, name, name_en, price, per })),
      transfers: p.transfers.filter(t => t.active !== false).map(({ key, name, name_en, price, per }) => ({ key, name, name_en, price, per })),
      limits: p.limits,
      availability_unit: pkg.availability.unit,
      per_option: !!pkg.availability.per_option,
    },
  };
  if (pkg.seo && Object.keys(pkg.seo).length) rec.seo = pkg.seo;
  // Only real, published reviews count: the legacy JSON "rating" values were
  // not backed by reviews and must never be shown as a customer rating.
  if (rating) { rec.rating = rating.avg; rec.reviews_count = rating.count; }
  else { rec.rating = null; rec.reviews_count = 0; }
  return rec;
}

/** All published packages of a kind, in display order. */
export async function listPublic(db, kind) {
  const { rows } = await db.query(
    `select * from packages where status = 'published' and kind = $1 order by sort_order, id`, [kind]);
  const ids = rows.map(r => r.id);
  const [rules, ratings] = await Promise.all([loadRules(db, ids), ratingMap(db, ids)]);
  return rows.map(r => publicRecord(r, rules.get(r.id) || [], ratings.get(r.id)));
}

export async function getPublic(db, id) {
  const { pkg, rules } = await loadPackage(db, id, { publishedOnly: true });
  const ratings = await ratingMap(db, [id]);
  return publicRecord(pkg, rules, ratings.get(id));
}
