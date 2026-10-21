// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/availability.js — Calendar management (capacity, blocked days)
// validated against existing confirmed bookings.
// ─────────────────────────────────────────────────────────────────────────────
import { calendar, resourceKeyFor } from '../../lib/availability.js';
import { getSetting, loadPackage } from '../../lib/catalog.js';
import { audit } from '../../lib/audit.js';
import { addDays, diffDays, isDateString, todayLocal } from '../../lib/dates.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { tx } from '../../db.js';

const id = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,80}$' };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

export default async function availabilityRoutes(app) {
  const { pool } = app;

  // Calendar with bookings per day (admin view)
  app.get('/availability/:id', {
    schema: { params: { type: 'object', properties: { id } },
              querystring: { type: 'object', properties: { from: date, to: date, resource: { type: 'string', maxLength: 64 } } } },
  }, async req => {
    const { pkg } = await loadPackage(pool, req.params.id);
    const settings = await getSetting(pool, 'booking');
    const from = req.query.from || todayLocal();
    const to = req.query.to || addDays(from, 41);
    const option = req.query.resource && req.query.resource !== '*' ? req.query.resource : null;
    const days = await calendar(pool, pkg, { from, to, optionKey: option, settings });
    const rk = resourceKeyFor(pkg, option);
    const { rows: bookings } = await pool.query(
      `select a.day, b.id, b.reference, b.customer_name, b.status, b.adults, b.children, a.quantity, b.hold_expires_at
         from booking_allocations a join bookings b on b.id = a.booking_id
        where a.package_id = $1 and a.resource_key = $2 and a.day between $3 and $4 and b.status in ('pending','confirmed','completed')
        order by a.day, b.created_at`, [pkg.id, rk, from, to]);
    const byDay = new Map();
    bookings.forEach(b => { if (!byDay.has(b.day)) byDay.set(b.day, []); byDay.get(b.day).push(b); });
    return {
      package: { id: pkg.id, kind: pkg.kind, title: pkg.content.title || pkg.content.name, availability: pkg.availability,
                 options: pkg.pricing.options.map(o => ({ key: o.key, name: o.name })) },
      resource_key: rk,
      days: days.map(d => ({ ...d, bookings: byDay.get(d.day) || [] })),
    };
  });

  // Bulk-edit days: set capacity, block/unblock, add a note, or reset to defaults
  app.put('/availability/:id/days', {
    schema: {
      params: { type: 'object', properties: { id } },
      body: { type: 'object', required: ['from', 'to'], properties: {
        from: date, to: date,
        weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, maxItems: 7 },
        resource_key: { type: 'string', maxLength: 64 },
        capacity: { type: ['integer', 'null'], minimum: 0, maximum: 100000 },
        closed: { type: 'boolean' },
        note: { type: ['string', 'null'], maxLength: 300 },
        reset: { type: 'boolean' },
        force: { type: 'boolean' } } },
    },
  }, async req => {
    const b = req.body;
    if (!isDateString(b.from) || !isDateString(b.to) || b.to < b.from || diffDays(b.from, b.to) > 366) throw badRequest('invalid_range');
    const { pkg } = await loadPackage(pool, req.params.id);
    const rk = b.resource_key && b.resource_key !== '*' ? b.resource_key : '*';
    if (rk !== '*' && !pkg.pricing.options.some(o => o.key === rk)) throw badRequest('invalid_resource');
    const days = [];
    for (let d = b.from; d <= b.to; d = addDays(d, 1)) {
      if (!b.weekdays || !b.weekdays.length || b.weekdays.includes(new Date(d + 'T00:00:00Z').getUTCDay())) days.push(d);
    }
    return tx(pool, async c => {
      for (const d of days) await c.query('select pg_advisory_xact_lock(hashtext($1))', [`${pkg.id}|${rk}|${d}`]);
      // Confirmed bookings on affected days (pending holds are warned about but not blocking)
      const { rows: used } = await c.query(
        `select a.day, sum(a.quantity) filter (where b.status = 'confirmed')::int as confirmed,
                sum(a.quantity) filter (where b.status = 'pending')::int as pending
           from booking_allocations a join bookings b on b.id = a.booking_id
          where a.package_id = $1 and a.resource_key = $2 and a.day = any($3::date[]) and b.status in ('confirmed','pending')
          group by a.day`, [pkg.id, rk, days]);
      const conflicts = [];
      for (const u of used) {
        if (b.closed && u.confirmed) conflicts.push({ day: u.day, confirmed: u.confirmed, issue: 'closing_day_with_confirmed_bookings' });
        if (b.capacity !== undefined && b.capacity !== null && u.confirmed > b.capacity) conflicts.push({ day: u.day, confirmed: u.confirmed, issue: 'capacity_below_confirmed' });
      }
      if (conflicts.length && !b.force) throw conflict('availability_conflict', 'Some days already have confirmed bookings', conflicts);

      if (b.reset) {
        await c.query('delete from availability_days where package_id = $1 and resource_key = $2 and day = any($3::date[])', [pkg.id, rk, days]);
      } else {
        for (const d of days) {
          await c.query(
            `insert into availability_days (package_id, resource_key, day, capacity, closed, note, updated_by, updated_at)
             values ($1,$2,$3,$4,$5,$6,$7, now())
             on conflict (package_id, resource_key, day) do update set
               capacity = case when $8 then excluded.capacity else availability_days.capacity end,
               closed   = case when $9 then excluded.closed else availability_days.closed end,
               note     = case when $10 then excluded.note else availability_days.note end,
               updated_by = excluded.updated_by, updated_at = now()`,
            [pkg.id, rk, d, b.capacity ?? null, !!b.closed, b.note ?? null, req.user.id,
             b.capacity !== undefined, b.closed !== undefined, b.note !== undefined]);
        }
      }
      await audit(c, req.user, 'availability', pkg.id, 'days_updated', {
        resource_key: rk, from: b.from, to: b.to, weekdays: b.weekdays || null, count: days.length,
        capacity: b.capacity, closed: b.closed, note: b.note, reset: !!b.reset, forced: !!(conflicts.length && b.force), conflicts });
      const pendingAffected = used.filter(u => u.pending).map(u => u.day);
      return { ok: true, days: days.length, conflicts, pending_on_days: pendingAffected };
    });
  });
}
