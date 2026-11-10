// ─────────────────────────────────────────────────────────────────────────────
// quote-conversion.js — An accepted proposal becomes one booking in the existing
// system. Bookings need one package, so it uses the internal package
// "proposta-personalizada"; all the proposal's lines travel in the booking's
// price snapshot, which is what tickets and invoices read. Capacity is checked
// and taken for every catalogue item with a date; custom items have none.
// ─────────────────────────────────────────────────────────────────────────────
import { withPaymentInfo } from './boarding.js';
import { tx } from '../db.js';
import { audit } from './audit.js';
import { checkAndLock } from './availability.js';
import { mailData, statusUrl } from './bookings.js';
import { getSetting, loadPackage } from './catalog.js';
import { diffDays } from './dates.js';
import { badRequest, conflict } from './errors.js';
import { enqueueMail } from './mailer.js';
import { loadQuote, quoteRef } from './quotes.js';
import { computeQuoteTotals } from './quote-totals.js';
import { randomToken, reference, sha256 } from './security.js';

export const PROPOSAL_PACKAGE = 'proposta-personalizada';

const firstDate = q => [q.trip.date_from, ...q.items.map(i => i.date_from)].filter(Boolean).sort()[0] || null;
const lastDate = q => [q.trip.date_to, q.trip.date_from, ...q.items.flatMap(i => [i.date_to, i.date_from])].filter(Boolean).sort().pop() || null;

/** Why a proposal cannot become a booking, whatever the availability says. */
function blockers(q) {
  const p = [];
  if (q.status === 'converted') p.push('quote_already_converted');
  else if (q.status !== 'accepted') p.push('quote_not_accepted');
  if (!firstDate(q)) p.push('trip_dates_required');
  return p;
}

/** Check every dated catalogue item, under locks. Returns one result per item. */
async function checkItems(c, q) {
  const settings = await getSetting(c, 'booking');
  const results = [];
  for (const item of q.items) {
    const r = { description: item.description, date: item.date_from || null, package_id: item.package_id || null, allocations: [] };
    results.push(r);
    if (!item.package_id) { r.state = 'not_controlled'; continue; }
    if (!item.date_from) { r.state = 'no_date'; continue; }
    try {
      const { pkg } = await loadPackage(c, item.package_id);
      const stay = pkg.kind === 'accommodation';
      r.allocations = (await checkAndLock(c, pkg, {
        start: item.date_from, optionKey: item.option_key || null, settings, ignoreStatic: true,
        nights: stay ? item.nights ?? (item.date_to ? diffDays(item.date_from, item.date_to) : undefined) : undefined,
        adults: item.adults ?? q.trip.adults ?? 1, children: item.children ?? q.trip.children ?? 0,
      })).map(a => ({ ...a, package_id: pkg.id }));
      r.state = 'available';
    } catch (err) {
      if (!err.status || err.status >= 500) throw err;
      r.state = 'unavailable';
      r.reason = err.code;
      r.detail = err.details || null;
    }
  }
  return results;
}

/** What the team reviews before confirming; nothing is written. */
export async function conversionPreview(pool, id) {
  return tx(pool, async c => {
    const q = await loadQuote(c, id);
    const { rows: [b] } = await c.query('select id, reference from bookings where quote_id = $1', [q.id]);
    const items = await checkItems(c, q);
    return { blockers: blockers(q), booking: b || null, start_date: firstDate(q), end_date: lastDate(q),
      items: items.map(({ allocations, ...i }) => i), can_convert: !blockers(q).length && !items.some(i => i.state === 'unavailable') };
  });
}

function bookingSnapshot(q) {
  const t = computeQuoteTotals({ items: q.items, discount: q.discount, fees: q.fees });
  const ref = quoteRef(q);
  const title = [`Proposta ${ref}`, q.trip.destination].filter(Boolean).join(' — ');
  const titleEn = [`Proposal ${ref}`, q.trip.destination].filter(Boolean).join(' — ');
  const discounts = [];
  if (t.line_discount_total) discounts.push({ source: 'quote', label: 'Descontos nos serviços', label_en: 'Service discounts', amount: t.line_discount_total });
  if (t.global_discount) discounts.push({ source: 'quote', label: 'Desconto', label_en: 'Discount', amount: t.global_discount });
  const lines = [
    ...t.items.map(i => ({ type: 'quote_item', label: i.description, label_en: i.description, quantity: i.quantity, unit_price: i.unit_price, amount: i.gross })),
    ...t.fees.map(f => ({ type: 'fee', label: f.label, label_en: f.label, quantity: 1, unit_price: f.amount, amount: f.amount })),
  ];
  return {
    computed_at: new Date().toISOString(), source: 'quote', quote_id: q.id,
    package: { id: PROPOSAL_PACKAGE, kind: 'tour', category: 'custom', version: 1, title, title_en: titleEn, meeting_point: null },
    quote: { currency: q.currency, lines, discounts, subtotal: t.subtotal + t.fees_total, discount_total: t.discount_total, total: t.total, option_key: null, notes: [] },
  };
}

/** Create the booking. The unique bookings.quote_id makes a second one impossible. */
export async function convertQuote(pool, cfg, { quoteId, actor, notify = true }) {
  return tx(pool, async c => {
    const q = await loadQuote(c, quoteId, { lock: true });
    const blocked = blockers(q);
    if (blocked.includes('quote_already_converted')) throw conflict('quote_already_converted', 'This proposal already became a booking');
    if (blocked.includes('quote_not_accepted')) throw conflict('quote_not_accepted', 'Only an accepted proposal can become a booking');
    if (blocked.length) throw badRequest(blocked[0]);
    const checked = await checkItems(c, q);
    const failed = checked.filter(i => i.state === 'unavailable');
    if (failed.length) throw conflict('quote_unavailable', 'Some services are not available', failed.map(f => `${f.description} (${f.date})`));

    const token = randomToken(24);
    const { adults = 1, children = 0 } = q.trip;
    let b;
    for (let attempt = 0; attempt < 5 && !b; attempt++) {
      ({ rows: [b] } = await c.query(
        `insert into bookings (reference, package_id, user_id, customer_name, customer_email, customer_phone, customer_country, locale, start_date, end_date,
            adults, children, status, customer_notes, currency, total, price_snapshot, lookup_token_hash, quote_id, confirmed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'confirmed',$13,$14,$15,$16,$17,$18, now())
         on conflict (reference) do nothing returning *`,
        [reference('MB'), PROPOSAL_PACKAGE, q.user_id, q.customer.company || q.customer.name, q.customer.email, q.customer.phone, q.customer.country, q.locale,
         firstDate(q), lastDate(q), adults, children, q.trip.customer_notes, q.currency, q.total, bookingSnapshot(q), sha256(token), q.id]));
    }
    if (!b) throw new Error('Could not allocate a unique booking reference');

    // The same package twice on a day adds up: one allocation row per package, resource and day
    const merged = new Map();
    for (const a of checked.flatMap(i => i.allocations)) {
      const key = `${a.package_id}|${a.resource_key}|${a.day}`;
      merged.set(key, { ...a, quantity: (merged.get(key)?.quantity || 0) + a.quantity });
    }
    for (const a of merged.values()) {
      await c.query(`insert into booking_allocations (booking_id, package_id, resource_key, day, quantity) values ($1,$2,$3,$4,$5)`,
        [b.id, a.package_id, a.resource_key, a.day, a.quantity]);
    }
    await c.query(`update quotes set status = 'converted', updated_at = now() where id = $1`, [q.id]);
    await audit(c, actor, 'booking', b.id, 'created', { reference: b.reference, total: b.total, status: 'confirmed', from_quote: quoteRef(q) });
    await audit(c, actor, 'quote', q.group_id, 'quote_converted', { quote_id: q.id, number: q.number, version: q.version, booking_id: b.id, booking_reference: b.reference });
    if (q.request_id) await audit(c, actor, 'request', q.request_id, 'quote_converted', { quote_id: q.id, booking_reference: b.reference });
    if (notify) {
      await enqueueMail(c, { key: `booking:${b.id}:status:confirmed`, to: b.customer_email, template: 'booking_status', locale: b.locale,
        data: await withPaymentInfo(c, mailData(b, cfg, { event: 'confirmed', status_url: statusUrl(cfg, b, token), attach_ticket_booking: b.id }), b.locale) });
    }
    return b;
  });
}
