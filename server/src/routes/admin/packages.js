// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/packages.js — Catalogue management: packages, accommodations,
// price rules, revisions (preview / restore) and price-change previews.
// ─────────────────────────────────────────────────────────────────────────────
import { validatePricing } from '../../lib/pricing-model.js';
import { validateAvailability } from '../../lib/availability.js';
import { computeQuote } from '../../lib/pricing.js';
import { activePromotions } from '../../lib/bookings.js';
import { loadPackage, publicRecord } from '../../lib/catalog.js';
import { audit } from '../../lib/audit.js';
import { todayLocal } from '../../lib/dates.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { tx } from '../../db.js';

const id = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,80}$' };
const date = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

/** Categories already used by the public site (tabs, filters, URLs). */
export const CATEGORIES = {
  tour: ['island-daytrips', 'beach-daytrips', 'safaris', 'transfers', 'maputo-city-tour', 'whale-watching', 'fishing-charters'],
  accommodation: ['inhaca', 'machangulo'],
};

const IMG_RE = /^(\.\.\/)?assets\/images\/[A-Za-z0-9/_.-]+\.(webp|jpe?g|png|avif)$/;

/**
 * Strip angle brackets from every string (the public renderers insert content
 * as HTML) and enforce size limits. Images must point into assets/images/.
 */
export function sanitizeContent(value, depth = 0) {
  if (depth > 6) throw badRequest('invalid_content', 'Content is nested too deeply');
  if (typeof value === 'string') return value.replace(/[<>]/g, '').slice(0, 8000);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    if (value.length > 200) throw badRequest('invalid_content', 'List too long');
    return value.map(v => sanitizeContent(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!/^[a-z][a-z0-9_]{0,40}$/i.test(k)) throw badRequest('invalid_content', `Invalid field name "${k}"`);
      if (k === 'image_alts' && v && typeof v === 'object' && !Array.isArray(v)) {
        // { "<image path>": { pt, en } } — keys are image paths, not field names
        out[k] = {};
        for (const [img, alt] of Object.entries(v)) {
          if (!IMG_RE.test(img)) throw badRequest('invalid_content', `Invalid image path "${img}"`);
          out[k][img] = { pt: String(alt?.pt ?? '').replace(/[<>]/g, '').slice(0, 300), en: String(alt?.en ?? '').replace(/[<>]/g, '').slice(0, 300) };
        }
        continue;
      }
      out[k] = sanitizeContent(v, depth + 1);
    }
    return out;
  }
  throw badRequest('invalid_content');
}

function checkContent(kind, content) {
  const c = sanitizeContent(content || {});
  const errs = [];
  if (kind === 'tour' && !c.title) errs.push('title is required');
  if (kind === 'accommodation' && !c.name) errs.push('name is required');
  for (const img of [c.cover, ...(c.images || [])].filter(Boolean)) {
    if (typeof img !== 'string' || !IMG_RE.test(img)) errs.push(`invalid image path: ${img}`);
  }
  if (c.images && !Array.isArray(c.images)) errs.push('images must be a list');
  if (JSON.stringify(c).length > 200000) errs.push('content too large');
  if (errs.length) throw badRequest('invalid_content', 'Invalid content', errs);
  return c;
}

function checkSeo(seo = {}) {
  const s = sanitizeContent(seo);
  const allowed = ['title', 'title_en', 'description', 'description_en', 'og_image'];
  const out = {};
  for (const k of allowed) if (s[k]) out[k] = String(s[k]).slice(0, k.startsWith('description') ? 300 : 120);
  if (out.og_image && !IMG_RE.test(out.og_image)) throw badRequest('invalid_content', 'Invalid og_image path');
  return out;
}

const packageBody = {
  type: 'object',
  properties: {
    id, kind: { type: 'string', enum: ['tour', 'accommodation'] },
    category: { type: 'string', maxLength: 40 },
    status: { type: 'string', enum: ['draft', 'published', 'archived'] },
    featured: { type: 'boolean' }, promotional: { type: 'boolean' },
    sort_order: { type: 'integer', minimum: -10000, maximum: 10000 },
    content: { type: 'object', additionalProperties: true },
    pricing: { type: 'object', additionalProperties: true },
    availability: { type: 'object', additionalProperties: true },
    seo: { type: 'object', additionalProperties: true },
    version: { type: 'integer' },
  },
};

const ruleBody = {
  type: 'object', required: ['label'],
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 120 },
    date_from: date, date_to: date,
    weekdays: { type: ['array', 'null'], items: { type: 'integer', minimum: 0, maximum: 6 }, maxItems: 7 },
    option_key: { type: ['string', 'null'], maxLength: 64 },
    adult: { type: ['number', 'null'], minimum: 0, maximum: 1e9 },
    child: { type: ['number', 'null'], minimum: 0, maximum: 1e9 },
    priority: { type: 'integer', minimum: -100, maximum: 1000 },
    active: { type: 'boolean' },
  },
};

function checkRule(r, pkg) {
  if (r.date_from && r.date_to && r.date_to < r.date_from) throw badRequest('invalid_rule', 'End date is before start date');
  if ((r.adult === null || r.adult === undefined) && (r.child === null || r.child === undefined)) throw badRequest('invalid_rule', 'Set an adult and/or child price');
  if (r.option_key && !pkg.pricing.options.some(o => o.key === r.option_key)) throw badRequest('invalid_rule', 'Unknown option');
}

async function snapshot(c, pkgId, actor, via) {
  const { rows: [p] } = await c.query('select * from packages where id = $1', [pkgId]);
  const { rows: rules } = await c.query('select label, date_from, date_to, weekdays, option_key, adult, child, priority, active from price_rules where package_id = $1 order by id', [pkgId]);
  await c.query(`insert into package_revisions (package_id, version, snapshot, changed_by) values ($1,$2,$3,$4)
                 on conflict (package_id, version) do nothing`,
    [pkgId, p.version, { via, status: p.status, category: p.category, featured: p.featured, promotional: p.promotional,
      sort_order: p.sort_order, content: p.content, pricing: p.pricing, availability: p.availability, seo: p.seo, rules }, actor.id]);
  return p;
}

export default async function packageRoutes(app) {
  const { pool } = app;

  app.get('/categories', async () => CATEGORIES);

  app.get('/packages', async () => {
    const { rows } = await pool.query(
      `select p.id, p.kind, p.category, p.status, p.featured, p.promotional, p.sort_order, p.version, p.updated_at,
              coalesce(p.content->>'title', p.content->>'name') as title, p.content->>'cover' as cover,
              p.content->'images'->>0 as first_image, p.pricing->>'currency' as currency, (p.pricing->>'adult')::numeric as base_price,
              p.pricing->>'unit' as unit, p.availability->>'default_capacity' as default_capacity,
              (select count(*)::int from bookings b where b.package_id = p.id and b.status in ('pending','confirmed') and b.start_date >= current_date) as upcoming
         from packages p order by p.kind, p.sort_order, p.id`);
    return rows;
  });

  app.get('/packages/:id', { schema: { params: { type: 'object', properties: { id } } } }, async req => {
    const { pkg, rules } = await loadPackage(pool, req.params.id);
    const { rows: allRules } = await pool.query('select * from price_rules where package_id = $1 order by priority desc, id', [pkg.id]);
    const { rows: revisions } = await pool.query(
      `select r.version, r.changed_at, r.snapshot->>'via' as via, u.name as changed_by
         from package_revisions r left join users u on u.id = r.changed_by where r.package_id = $1 order by r.version desc limit 50`, [pkg.id]);
    return { package: pkg, rules: allRules, revisions, public_preview: publicRecord(pkg, rules) };
  });

  // Public-shaped record for previewing drafts on the real package page
  app.get('/packages/:id/public', { schema: { params: { type: 'object', properties: { id } } } }, async req => {
    const { pkg, rules } = await loadPackage(pool, req.params.id);
    return publicRecord(pkg, rules);
  });

  app.post('/packages', { schema: { body: { ...packageBody, required: ['id', 'kind', 'category', 'content', 'pricing'] } } }, async (req, reply) => {
    const b = req.body;
    if (!CATEGORIES[b.kind].includes(b.category)) throw badRequest('invalid_category', `Category must be one of: ${CATEGORIES[b.kind].join(', ')}`);
    const content = checkContent(b.kind, b.content);
    const pricing = validatePricing(b.pricing);
    const availability = validateAvailability(b.availability || {});
    const seo = checkSeo(b.seo);
    const row = await tx(pool, async c => {
      const exists = await c.query('select 1 from packages where id = $1', [b.id]);
      if (exists.rowCount) throw conflict('id_taken', 'A package with this id already exists');
      await c.query(
        `insert into packages (id, kind, category, status, featured, promotional, sort_order, content, pricing, availability, seo, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [b.id, b.kind, b.category, b.status || 'draft', !!b.featured, !!b.promotional, b.sort_order ?? 999,
         content, pricing, availability, seo, req.user.id]);
      const p = await snapshot(c, b.id, req.user, 'created');
      await audit(c, req.user, 'package', b.id, 'created', { status: p.status });
      return p;
    });
    reply.code(201);
    return row;
  });

  // Full update with optimistic concurrency (send the version you edited)
  app.put('/packages/:id', { schema: { params: { type: 'object', properties: { id } }, body: { ...packageBody, required: ['version'] } } }, async req => {
    const b = req.body;
    return tx(pool, async c => {
      const { rows: [cur] } = await c.query('select * from packages where id = $1 for update', [req.params.id]);
      if (!cur) throw notFound('package_not_found');
      if (cur.version !== b.version) throw conflict('version_conflict', 'This package was changed by someone else. Reload and try again.');
      const kind = cur.kind;
      const category = b.category ?? cur.category;
      if (!CATEGORIES[kind].includes(category)) throw badRequest('invalid_category');
      const content = b.content ? checkContent(kind, b.content) : cur.content;
      const pricing = b.pricing ? validatePricing(b.pricing) : cur.pricing;
      const availability = b.availability ? validateAvailability(b.availability) : cur.availability;
      const seo = b.seo ? checkSeo(b.seo) : cur.seo;
      const { rows: [u] } = await c.query(
        `update packages set category=$2, status=$3, featured=$4, promotional=$5, sort_order=$6, content=$7, pricing=$8,
                availability=$9, seo=$10, version=version+1, updated_at=now(), updated_by=$11 where id=$1 returning *`,
        [cur.id, category, b.status ?? cur.status, b.featured ?? cur.featured, b.promotional ?? cur.promotional,
         b.sort_order ?? cur.sort_order, content, pricing, availability, seo, req.user.id]);
      await snapshot(c, cur.id, req.user, 'edited');
      const changed = ['status', 'category', 'featured', 'promotional', 'sort_order', 'content', 'pricing', 'availability', 'seo']
        .filter(k => JSON.stringify(cur[k]) !== JSON.stringify(u[k]));
      await audit(c, req.user, 'package', cur.id, 'updated', { version: u.version, changed,
        ...(changed.includes('pricing') ? { pricing_before: cur.pricing, pricing_after: u.pricing } : {}) });
      return u;
    });
  });

  app.post('/packages/:id/restore/:version', {
    schema: { params: { type: 'object', properties: { id, version: { type: 'string', pattern: '^\\d{1,6}$' } } } },
  }, async req => tx(pool, async c => {
    const { rows: [rev] } = await c.query('select snapshot from package_revisions where package_id = $1 and version = $2', [req.params.id, Number(req.params.version)]);
    if (!rev || !rev.snapshot.pricing) throw notFound('revision_not_found', 'This revision cannot be restored');
    const s = rev.snapshot;
    await c.query('select 1 from packages where id = $1 for update', [req.params.id]);
    const { rows: [u] } = await c.query(
      `update packages set status=$2, category=$3, featured=$4, promotional=$5, sort_order=$6, content=$7, pricing=$8, availability=$9, seo=$10,
              version=version+1, updated_at=now(), updated_by=$11 where id=$1 returning *`,
      [req.params.id, s.status, s.category, s.featured, s.promotional, s.sort_order, s.content, s.pricing, s.availability, s.seo || {}, req.user.id]);
    await c.query('delete from price_rules where package_id = $1', [req.params.id]);
    for (const r of s.rules || []) {
      await c.query(`insert into price_rules (package_id, label, date_from, date_to, weekdays, option_key, adult, child, priority, active)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [req.params.id, r.label, r.date_from, r.date_to, r.weekdays, r.option_key, r.adult, r.child, r.priority, r.active]);
    }
    await snapshot(c, req.params.id, req.user, `restored v${req.params.version}`);
    await audit(c, req.user, 'package', req.params.id, 'restored', { from_version: Number(req.params.version), version: u.version });
    return u;
  }));

  // Compare a quote with current vs proposed pricing before saving
  app.post('/packages/:id/pricing-preview', {
    schema: { params: { type: 'object', properties: { id } },
              body: { type: 'object', required: ['date', 'adults'], properties: {
                pricing: { type: 'object', additionalProperties: true },
                date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                adults: { type: 'integer', minimum: 0, maximum: 200 }, children: { type: 'integer', minimum: 0, maximum: 200 },
                option_key: { type: ['string', 'null'] }, extras: { type: 'array', items: { type: 'string' } }, transfer_key: { type: ['string', 'null'] } } } },
  }, async req => {
    const { pkg, rules } = await loadPackage(pool, req.params.id);
    const promotions = await activePromotions(pool);
    const input = { date: req.body.date, adults: req.body.adults, children: req.body.children || 0,
                    option_key: req.body.option_key || null, extras: req.body.extras || [], transfer_key: req.body.transfer_key || null };
    const run = pricing => {
      try { return computeQuote({ pkg: { ...pkg, pricing }, rules, input, promotions, today: todayLocal() }); }
      catch (e) { return { error: e.code || 'error', details: e.details }; }
    };
    return { current: run(pkg.pricing), proposed: req.body.pricing ? run(validatePricing(req.body.pricing)) : null };
  });

  // ── Price rules ────────────────────────────────────────────────────────────
  app.post('/packages/:id/rules', { schema: { params: { type: 'object', properties: { id } }, body: ruleBody } }, async (req, reply) => {
    const { pkg } = await loadPackage(pool, req.params.id);
    checkRule(req.body, pkg);
    const r = req.body;
    const row = await tx(pool, async c => {
      const { rows: [n] } = await c.query(
        `insert into price_rules (package_id, label, date_from, date_to, weekdays, option_key, adult, child, priority, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [pkg.id, r.label, r.date_from || null, r.date_to || null, r.weekdays && r.weekdays.length ? r.weekdays : null,
         r.option_key || null, r.adult ?? null, r.child ?? null, r.priority ?? 0, r.active !== false]);
      await c.query('update packages set version = version + 1, updated_at = now(), updated_by = $2 where id = $1', [pkg.id, req.user.id]);
      await snapshot(c, pkg.id, req.user, 'price rule added');
      await audit(c, req.user, 'package', pkg.id, 'price_rule_created', { rule: n });
      return n;
    });
    reply.code(201);
    return row;
  });

  app.put('/rules/:ruleId', { schema: { params: { type: 'object', properties: { ruleId: { type: 'string', pattern: '^\\d{1,12}$' } } }, body: ruleBody } }, async req => {
    const { rows: [old] } = await pool.query('select * from price_rules where id = $1', [req.params.ruleId]);
    if (!old) throw notFound('rule_not_found');
    const { pkg } = await loadPackage(pool, old.package_id);
    checkRule(req.body, pkg);
    const r = req.body;
    return tx(pool, async c => {
      const { rows: [n] } = await c.query(
        `update price_rules set label=$2, date_from=$3, date_to=$4, weekdays=$5, option_key=$6, adult=$7, child=$8, priority=$9, active=$10
          where id=$1 returning *`,
        [old.id, r.label, r.date_from || null, r.date_to || null, r.weekdays && r.weekdays.length ? r.weekdays : null,
         r.option_key || null, r.adult ?? null, r.child ?? null, r.priority ?? 0, r.active !== false]);
      await c.query('update packages set version = version + 1, updated_at = now(), updated_by = $2 where id = $1', [pkg.id, req.user.id]);
      await snapshot(c, pkg.id, req.user, 'price rule edited');
      await audit(c, req.user, 'package', pkg.id, 'price_rule_updated', { before: old, after: n });
      return n;
    });
  });

  app.delete('/rules/:ruleId', { schema: { params: { type: 'object', properties: { ruleId: { type: 'string', pattern: '^\\d{1,12}$' } } } } }, async req => {
    return tx(pool, async c => {
      const { rows: [old] } = await c.query('delete from price_rules where id = $1 returning *', [req.params.ruleId]);
      if (!old) throw notFound('rule_not_found');
      await c.query('update packages set version = version + 1, updated_at = now(), updated_by = $2 where id = $1', [old.package_id, req.user.id]);
      await snapshot(c, old.package_id, req.user, 'price rule removed');
      await audit(c, req.user, 'package', old.package_id, 'price_rule_deleted', { rule: old });
      return { ok: true };
    });
  });
}
