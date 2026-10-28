// ─────────────────────────────────────────────────────────────────────────────
// bookings.js — Booking lifecycle. Prices are always recomputed here from
// database values; capacity is checked under advisory locks inside the same
// transaction that writes the booking.
//
// Lifecycle:  pending ──► confirmed ──► completed
//                │            │
//                ├──► rejected└──► cancelled
//                └──► cancelled
// ─────────────────────────────────────────────────────────────────────────────
import { tx } from '../db.js';
import { getSetting, loadPackage } from './catalog.js';
import { computeQuote } from './pricing.js';
import { checkAndLock, endDateFor } from './availability.js';
import { diffDays } from './dates.js';
import { loyaltyStatus } from './loyalty.js';
import { audit } from './audit.js';
import { enqueueMail, notifyTeam } from './mailer.js';
import { isDateString, todayLocal } from './dates.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { randomToken, reference, sha256 } from './security.js';
import { syncFinancialState } from './payments.js';

/** Nights of an existing stay (from its dates); undefined for tours. */
const stayLength = (pkg, b) => (pkg.kind === 'accommodation' ? diffDays(b.start_date, b.end_date) : undefined);

export const TRANSITIONS = {
  pending:   ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['cancelled', 'completed'],
  rejected:  [],
  cancelled: [],
  completed: [],
};

export async function activePromotions(db) {
  const { rows } = await db.query(`select * from promotions where active`);
  return rows;
}

/** Price preview (used by POST /api/quote and inside createBooking). */
export async function quoteFor(db, { packageId, input, user, publishedOnly = true }) {
  if (!isDateString(input.date)) throw badRequest('invalid_date');
  const { pkg, rules } = await loadPackage(db, packageId, { publishedOnly });
  const [promotions, loyalty] = await Promise.all([activePromotions(db), loyaltyStatus(db, user)]);
  const quote = computeQuote({ pkg, rules, input, promotions, loyalty, today: todayLocal() });
  return { pkg, quote };
}

function snapshotOf(pkg, quote) {
  const c = pkg.content || {};
  return {
    computed_at: new Date().toISOString(),
    package: { id: pkg.id, kind: pkg.kind, category: pkg.category, version: pkg.version,
               title: c.title || c.name || pkg.id, title_en: c.title_en || c.name_en || c.title || c.name || pkg.id,
               meeting_point: c.meeting_point || null },
    quote,
  };
}

/** Data used by every booking e-mail. */
export function mailData(b, cfg, extra = {}) {
  const s = b.price_snapshot || {};
  const en = b.locale === 'en';
  const opt = s.quote && s.quote.option_key && s.quote.lines.find(l => l.type === 'group' || l.type === 'night');
  return {
    reference: b.reference, customer_name: b.customer_name, customer_email: b.customer_email, customer_phone: b.customer_phone,
    package_title: en ? s.package?.title_en : s.package?.title,
    start_date: b.start_date, end_date: b.end_date, adults: b.adults, children: b.children,
    option_name: opt ? (en ? opt.label_en : opt.label) : null,
    total: b.total, currency: b.currency, status: b.status,
    child_price_on_request: !!(s.quote && s.quote.child_price_on_request),
    meeting_point: s.package?.meeting_point ? [s.package.meeting_point.name, s.package.meeting_point.address].filter(Boolean).join(' — ') : null,
    admin_url: `${cfg.publicBaseUrl}/admin/#/bookings/${b.id}`,
    ...extra,
  };
}

export function statusUrl(cfg, b, token) {
  const page = b.locale === 'en' ? 'en/booking-status.html' : 'pages/booking-status.html';
  return `${cfg.publicBaseUrl}/${page}?ref=${encodeURIComponent(b.reference)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}

/**
 * Create a booking request (guest or signed-in customer).
 * Repeating the same idempotency_key returns the original booking.
 */
export async function createBooking(pool, cfg, { input, user }) {
  if (input.idempotency_key) {
    const { rows } = await pool.query('select * from bookings where idempotency_key = $1', [input.idempotency_key]);
    if (rows[0]) return { booking: rows[0], duplicate: true };
  }
  const settings = await getSetting(pool, 'booking');
  const { pkg, quote } = await quoteFor(pool, { packageId: input.package_id, input, user });

  const token = randomToken(24);
  const booking = await tx(pool, async c => {
    const allocations = await checkAndLock(c, pkg, {
      start: input.date, nights: quote.nights || undefined, optionKey: quote.option_key, adults: quote.adults, children: quote.children, settings,
    });
    const holdHours = settings.pending_holds_capacity !== false ? Number(settings.pending_hold_hours || 48) : 0;
    let row;
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      const { rows } = await c.query(
        `insert into bookings (reference, package_id, user_id, customer_name, customer_email, customer_phone, customer_country,
            locale, start_date, end_date, adults, children, option_key, extras, transfer_key, customer_notes, currency, total,
            price_snapshot, hold_expires_at, idempotency_key, lookup_token_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                 case when $20::int > 0 then now() + make_interval(hours => $20::int) end, $21, $22)
         on conflict (reference) do nothing returning *`,
        [reference('MB'), pkg.id, user ? user.id : null, input.customer.name, input.customer.email.toLowerCase(), input.customer.phone,
         input.customer.country || null, input.locale === 'en' ? 'en' : 'pt', input.date, endDateFor(pkg, input.date, quote.nights || undefined),
         quote.adults, quote.children, quote.option_key, JSON.stringify(quote.lines.filter(l => l.type === 'extra').map(l => l.key)),
         input.transfer_key || null, input.notes || null, quote.currency, quote.total, snapshotOf(pkg, quote), holdHours,
         input.idempotency_key || null, sha256(token)]);
      row = rows[0];
    }
    if (!row) throw new Error('Could not allocate a unique booking reference');
    for (const a of allocations) {
      await c.query(`insert into booking_allocations (booking_id, package_id, resource_key, day, quantity) values ($1,$2,$3,$4,$5)`,
        [row.id, pkg.id, a.resource_key, a.day, a.quantity]);
    }
    for (const d of quote.discounts.filter(d => d.promotion_id)) {
      await c.query('update promotions set used_count = used_count + 1 where id = $1', [d.promotion_id]);
    }
    await audit(c, user, 'booking', row.id, 'created', { reference: row.reference, total: row.total, status: 'pending' });
    const data = mailData(row, cfg, { status_url: statusUrl(cfg, row, token), attach_ticket_booking: row.id });
    await enqueueMail(c, { key: `booking:${row.id}:received`, to: row.customer_email, template: 'booking_received', locale: row.locale, data });
    await notifyTeam(c, { key: `booking:${row.id}:admin_new`, template: 'admin_new_booking', data: { ...data, attach_ticket_booking: undefined } });
    return row;
  }).catch(async err => {
    // Two identical requests racing: the unique idempotency key decides the winner
    if (err.code === '23505' && input.idempotency_key) {
      const { rows } = await pool.query('select * from bookings where idempotency_key = $1', [input.idempotency_key]);
      if (rows[0]) return { ...rows[0], __dup: true };
    }
    throw err;
  });
  if (booking.__dup) { delete booking.__dup; return { booking, duplicate: true }; }
  return { booking, token, duplicate: false };
}

/** Change a booking status, enforcing the lifecycle. */
export async function transitionBooking(pool, cfg, { bookingId, to, actor, message = null, notify = true, now = new Date() }) {
  return tx(pool, async c => {
    const { rows } = await c.query('select * from bookings where id = $1 for update', [bookingId]);
    const b = rows[0];
    if (!b) throw notFound('booking_not_found');
    const isAdmin = actor && actor.role === 'admin';
    const isSystem = actor === 'system';
    if (!isAdmin && !isSystem) {
      // Customers may only cancel their own *pending* request
      if (!(to === 'cancelled' && b.status === 'pending' && actor && b.user_id === actor.id)) throw forbidden();
    }
    if (!TRANSITIONS[b.status].includes(to)) throw conflict('invalid_transition', `Cannot change ${b.status} → ${to}`);

    if (to === 'confirmed') {
      const { pkg } = await loadPackage(c, b.package_id);
      const settings = await getSetting(c, 'booking');
      // Re-verify capacity (excluding this booking's own hold); date rules were checked at request time
      await checkAndLock(c, pkg, { start: b.start_date, nights: stayLength(pkg, b), optionKey: b.option_key, adults: b.adults, children: b.children,
        settings, excludeBookingId: b.id, ignoreStatic: true, now });
    }
    const stamp = { confirmed: 'confirmed_at', cancelled: 'cancelled_at', completed: 'completed_at' }[to];
    const { rows: [updated] } = await c.query(
      `update bookings set status = $2, updated_at = now(), hold_expires_at = null
              ${stamp ? `, ${stamp} = now()` : ''} where id = $1 returning *`, [b.id, to]);
    await audit(c, isSystem ? null : actor, 'booking', b.id, 'status_changed',
      { from: b.status, to, message, ...(isSystem ? { __system: true } : {}) });
    if (notify) {
      await enqueueMail(c, { key: `booking:${b.id}:status:${to}`, to: b.customer_email, template: 'booking_status', locale: b.locale,
        data: mailData(updated, cfg, { event: to, message, status_url: statusUrl(cfg, updated), ...(to === 'confirmed' ? { attach_ticket_booking: b.id } : {}) }) });
    }
    return updated;
  });
}

/** Customer asks for cancellation of a confirmed booking (admin decides). */
export async function requestCancellation(pool, cfg, { bookingId, user, reason }) {
  return tx(pool, async c => {
    const { rows: [b] } = await c.query('select * from bookings where id = $1 for update', [bookingId]);
    if (!b || b.user_id !== user.id) throw notFound('booking_not_found');
    if (!['pending', 'confirmed'].includes(b.status)) throw conflict('invalid_transition');
    if (b.cancel_requested_at) return b;
    const { rows: [u] } = await c.query('update bookings set cancel_requested_at = now(), updated_at = now() where id = $1 returning *', [b.id]);
    await audit(c, user, 'booking', b.id, 'cancel_requested', { reason: reason || null });
    await notifyTeam(c, { key: `booking:${b.id}:cancel_request`, template: 'admin_cancel_request', data: mailData(u, cfg, { reason }) });
    return u;
  });
}

/**
 * Admin edit of permitted fields. Changing date/guests/option recomputes the
 * quote with current prices (new snapshot; the previous one is kept in the
 * audit log) unless keep_price is set.
 */
export async function updateBooking(pool, cfg, { bookingId, actor, patch }) {
  return tx(pool, async c => {
    const { rows: [b] } = await c.query('select * from bookings where id = $1 for update', [bookingId]);
    if (!b) throw notFound('booking_not_found');
    if (!['pending', 'confirmed'].includes(b.status)) throw conflict('booking_locked', 'Only pending or confirmed bookings can be edited');

    const next = {
      customer_name: patch.customer_name ?? b.customer_name,
      customer_email: (patch.customer_email ?? b.customer_email).toLowerCase(),
      customer_phone: patch.customer_phone ?? b.customer_phone,
      customer_country: patch.customer_country ?? b.customer_country,
      start_date: patch.date ?? b.start_date,
      adults: patch.adults ?? b.adults,
      children: patch.children ?? b.children,
      option_key: patch.option_key !== undefined ? patch.option_key : b.option_key,
      nights: patch.nights ?? diffDays(b.start_date, b.end_date),
    };
    const prevNights = diffDays(b.start_date, b.end_date);
    const tripChanged = next.start_date !== b.start_date || next.adults !== b.adults || next.children !== b.children
      || next.option_key !== b.option_key || next.nights !== prevNights;
    let snapshot = b.price_snapshot, total = b.total, end = b.end_date;

    if (tripChanged) {
      if (!isDateString(next.start_date)) throw badRequest('invalid_date');
      const { pkg, rules } = await loadPackage(c, b.package_id);
      const settings = await getSetting(c, 'booking');
      if (!patch.keep_price) {
        const promotions = await activePromotions(c);
        const prevQuote = b.price_snapshot.quote || {};
        const quote = computeQuote({ pkg, rules, promotions: promotions.filter(p => (prevQuote.discounts || []).some(d => d.promotion_id === p.id)),
          input: { date: next.start_date, nights: next.nights || undefined, adults: next.adults, children: next.children, option_key: next.option_key, extras: b.extras, transfer_key: b.transfer_key },
          today: todayLocal() });
        snapshot = snapshotOf(pkg, quote);
        total = quote.total;
      }
      end = endDateFor(pkg, next.start_date, pkg.kind === 'accommodation' ? next.nights : undefined);
      await c.query('delete from booking_allocations where booking_id = $1', [b.id]);
      const allocations = await checkAndLock(c, pkg, { start: next.start_date, nights: pkg.kind === 'accommodation' ? next.nights : undefined, optionKey: next.option_key, adults: next.adults,
        children: next.children, settings, excludeBookingId: b.id, ignoreStatic: true });
      for (const a of allocations) {
        await c.query(`insert into booking_allocations (booking_id, package_id, resource_key, day, quantity) values ($1,$2,$3,$4,$5)`,
          [b.id, b.package_id, a.resource_key, a.day, a.quantity]);
      }
    }
    if (patch.total_override !== undefined && patch.total_override !== null) {
      if (!patch.override_reason) throw badRequest('override_reason_required');
      total = patch.total_override;
      snapshot = { ...snapshot, manual_total: { total, reason: patch.override_reason, by: actor.id, at: new Date().toISOString() } };
    }
    const { rows: [u] } = await c.query(
      `update bookings set customer_name=$2, customer_email=$3, customer_phone=$4, customer_country=$5, start_date=$6, end_date=$7,
              adults=$8, children=$9, option_key=$10, total=$11, price_snapshot=$12, updated_at=now() where id=$1 returning *`,
      [b.id, next.customer_name, next.customer_email, next.customer_phone, next.customer_country, next.start_date, end,
       next.adults, next.children, next.option_key, total, snapshot]);
    await audit(c, actor, 'booking', b.id, 'updated', {
      before: { start_date: b.start_date, adults: b.adults, children: b.children, option_key: b.option_key, total: b.total, customer_email: b.customer_email },
      after: { start_date: u.start_date, adults: u.adults, children: u.children, option_key: u.option_key, total: u.total, customer_email: u.customer_email },
      previous_snapshot: tripChanged || patch.total_override !== undefined ? b.price_snapshot : undefined,
    });
    // A new total can change how much is still owed (an issued invoice keeps its own total)
    if (Number(u.total) !== Number(b.total)) Object.assign(u, (await syncFinancialState(c, b.id)).booking);
    if (patch.notify !== false && (tripChanged || patch.total_override !== undefined)) {
      await enqueueMail(c, { key: `booking:${b.id}:updated:${Date.now()}`, to: u.customer_email, template: 'booking_status', locale: u.locale,
        data: mailData(u, cfg, { event: 'updated', status_url: statusUrl(cfg, u) }) });
    }
    return u;
  });
}

// Payments live in payments.js (verification, refunds, reversals, invoice status)
export { recordPayment } from './payments.js';

/** Safe public projection of a booking (no internal fields). */
export function publicBooking(b) {
  const s = b.price_snapshot || {};
  return {
    id: b.id, reference: b.reference, status: b.status, payment_status: b.payment_status,
    package_id: b.package_id, package_title: s.package?.title, package_title_en: s.package?.title_en,
    start_date: b.start_date, end_date: b.end_date, adults: b.adults, children: b.children,
    option_key: b.option_key, currency: b.currency, total: b.total, amount_paid: b.amount_paid,
    lines: s.quote?.lines || [], discounts: s.quote?.discounts || [], subtotal: s.quote?.subtotal,
    child_price_on_request: !!s.quote?.child_price_on_request,
    customer_name: b.customer_name, created_at: b.created_at,
    cancel_requested: !!b.cancel_requested_at,
    hold_expires_at: b.status === 'pending' ? b.hold_expires_at : null,
  };
}

/** Background maintenance: auto-complete past trips and queue reminders. */
export async function runBookingMaintenance(pool, cfg) {
  const settings = await getSetting(pool, 'booking');
  const notif = await getSetting(pool, 'notifications');
  const today = todayLocal();
  let completed = 0;
  if (settings.auto_complete !== false) {
    const { rows } = await pool.query(`select id from bookings where status = 'confirmed' and end_date < $1 limit 200`, [today]);
    for (const r of rows) {
      await transitionBooking(pool, cfg, { bookingId: r.id, to: 'completed', actor: 'system' }).then(() => completed++).catch(() => {});
    }
  }
  const days = Number(notif.reminder_days_before ?? 2);
  let reminders = 0;
  if (days > 0) {
    const { rows } = await pool.query(
      `select * from bookings where status = 'confirmed' and start_date = ($1::date + $2::int)`, [today, days]);
    for (const b of rows) {
      await enqueueMail(pool, { key: `booking:${b.id}:reminder`, to: b.customer_email, template: 'trip_reminder', locale: b.locale, data: mailData(b, cfg) });
      reminders++;
    }
  }
  return { completed, reminders };
}
