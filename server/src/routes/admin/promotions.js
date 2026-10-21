// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/promotions.js — Promotions & discount codes.
// ─────────────────────────────────────────────────────────────────────────────
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { CATEGORIES } from './packages.js';

const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const date = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

const body = {
  type: 'object', required: ['name', 'kind', 'value'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    code: { type: ['string', 'null'], maxLength: 40, pattern: '^[A-Za-z0-9_-]*$' },
    kind: { type: 'string', enum: ['percent', 'fixed'] },
    value: { type: 'number', exclusiveMinimum: 0, maximum: 1e9 },
    max_discount: { type: ['number', 'null'], minimum: 0, maximum: 1e9 },
    package_ids: { type: ['array', 'null'], items: { type: 'string', maxLength: 90 }, maxItems: 200 },
    categories: { type: ['array', 'null'], items: { type: 'string', maxLength: 40 }, maxItems: 20 },
    starts_at: date, ends_at: date, travel_from: date, travel_to: date,
    min_pax: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
    min_total: { type: ['number', 'null'], minimum: 0, maximum: 1e9 },
    usage_limit: { type: ['integer', 'null'], minimum: 1, maximum: 1e6 },
    combinable: { type: 'boolean' },
    active: { type: 'boolean' },
  },
};

async function check(pool, p) {
  if (p.kind === 'percent' && p.value > 100) throw badRequest('invalid_promotion', 'A percentage cannot exceed 100');
  if (p.starts_at && p.ends_at && p.ends_at < p.starts_at) throw badRequest('invalid_promotion', 'End date is before start date');
  if (p.travel_from && p.travel_to && p.travel_to < p.travel_from) throw badRequest('invalid_promotion', 'Travel end is before travel start');
  const allCats = [...CATEGORIES.tour, ...CATEGORIES.accommodation];
  if (p.categories && p.categories.some(c => !allCats.includes(c))) throw badRequest('invalid_promotion', 'Unknown category');
  if (p.package_ids && p.package_ids.length) {
    const { rows } = await pool.query('select id from packages where id = any($1)', [p.package_ids]);
    if (rows.length !== new Set(p.package_ids).size) throw badRequest('invalid_promotion', 'Unknown package');
  }
}

const COLS = ['name', 'code', 'kind', 'value', 'max_discount', 'package_ids', 'categories', 'starts_at', 'ends_at',
  'travel_from', 'travel_to', 'min_pax', 'min_total', 'usage_limit', 'combinable', 'active'];
const values = p => COLS.map(k => {
  const v = p[k];
  if (k === 'code') return v ? v.toUpperCase() : null;
  if (k === 'package_ids' || k === 'categories') return v && v.length ? v : null;
  if (k === 'combinable') return !!v;
  if (k === 'active') return v !== false;
  return v ?? null;
});

export default async function promotionRoutes(app) {
  const { pool } = app;

  app.get('/promotions', async () => {
    const { rows } = await pool.query('select * from promotions order by active desc, created_at desc');
    return rows;
  });

  app.post('/promotions', { schema: { body } }, async (req, reply) => {
    await check(pool, req.body);
    try {
      const { rows: [p] } = await pool.query(
        `insert into promotions (${COLS.join(',')}) values (${COLS.map((_, i) => `$${i + 1}`).join(',')}) returning *`, values(req.body));
      await audit(pool, req.user, 'promotion', p.id, 'created', p);
      reply.code(201);
      return p;
    } catch (e) {
      if (e.code === '23505') throw conflict('code_taken', 'This promotion code already exists');
      throw e;
    }
  });

  app.put('/promotions/:id', { schema: { params: { type: 'object', properties: { id: uuid } }, body } }, async req => {
    await check(pool, req.body);
    const { rows: [old] } = await pool.query('select * from promotions where id = $1', [req.params.id]);
    if (!old) throw notFound('promotion_not_found');
    try {
      const { rows: [p] } = await pool.query(
        `update promotions set ${COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1 returning *`,
        [req.params.id, ...values(req.body)]);
      await audit(pool, req.user, 'promotion', p.id, 'updated', { before: old, after: p });
      return p;
    } catch (e) {
      if (e.code === '23505') throw conflict('code_taken', 'This promotion code already exists');
      throw e;
    }
  });

  // Promotions are deactivated, not deleted, once used (bookings reference them in snapshots)
  app.delete('/promotions/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async req => {
    const { rows: [old] } = await pool.query('select * from promotions where id = $1', [req.params.id]);
    if (!old) throw notFound('promotion_not_found');
    if (old.used_count > 0) {
      await pool.query('update promotions set active = false, updated_at = now() where id = $1', [old.id]);
      await audit(pool, req.user, 'promotion', old.id, 'deactivated', {});
      return { ok: true, deactivated: true };
    }
    await pool.query('delete from promotions where id = $1', [old.id]);
    await audit(pool, req.user, 'promotion', old.id, 'deleted', old);
    return { ok: true, deleted: true };
  });
}
