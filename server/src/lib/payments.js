// ─────────────────────────────────────────────────────────────────────────────
// payments.js — Verified payments, refunds and reversals, and the financial
// state derived from them (booking.payment_status + invoice.pay_status).
//
// Rules
//   • Only an administrator records money, and only after confirming it was
//     actually received (verified = true). Nothing is ever marked paid because
//     a booking was created, an invoice issued or a method chosen.
//   • kind 'payment'  amount > 0, cannot exceed the outstanding balance.
//     kind 'refund'   money returned (stored negative), ≤ amount paid.
//     kind 'reversal' cancels one earlier payment (bounced/mistaken entry);
//                     the original row stays, linked by reverses_payment_id.
//   • Rows are never updated or deleted: the history is the audit trail.
//   • The paid amount is always re-summed by PostgreSQL (exact NUMERIC), never
//     accumulated in JavaScript floats.
//   • An idempotency key per submission makes double-clicks/retries harmless;
//     the same external reference twice for one booking is refused.
// ─────────────────────────────────────────────────────────────────────────────
import { tx } from '../db.js';
import { audit } from './audit.js';
import { todayLocal } from './dates.js';
import { badRequest, conflict, notFound } from './errors.js';

export const METHODS = ['cash', 'bank_transfer', 'mpesa', 'emola', 'card', 'other'];

/** Integer cents from a NUMERIC/number value (avoids float drift in comparisons). */
export const cents = n => Math.round(Number(n || 0) * 100);

/** Invoice financial state from cents. */
export function invoicePayStatus(paidCents, totalCents, hadRefund) {
  if (paidCents <= 0) return hadRefund ? 'refunded' : 'unpaid';
  return paidCents >= totalCents ? 'paid' : 'partially_paid';
}

/**
 * Re-derive the paid amount from the payment rows and store it on the booking
 * and on its active issued invoice. Call inside the transaction that changed
 * payments (booking row already locked).
 */
export async function syncFinancialState(c, bookingId) {
  const { rows: [s] } = await c.query(
    `select coalesce(sum(amount), 0)::numeric(12,2) as paid, bool_or(kind = 'refund') as had_refund
       from payments where booking_id = $1`, [bookingId]);
  const paid = Number(s.paid);
  const { rows: [b] } = await c.query('select total from bookings where id = $1', [bookingId]);
  const bPaid = cents(paid), bTotal = cents(b.total);
  const bookingStatus = bPaid <= 0 ? (s.had_refund ? 'refunded' : 'unpaid') : bPaid >= bTotal ? 'paid' : 'partial';
  const { rows: [booking] } = await c.query(
    'update bookings set amount_paid = $2, payment_status = $3, updated_at = now() where id = $1 returning *', [bookingId, paid, bookingStatus]);

  const { rows: [inv] } = await c.query(
    `select * from invoices where booking_id = $1 and doc_status = 'issued' for update`, [bookingId]);
  let invoice = null, becamePaid = false;
  if (inv) {
    const status = invoicePayStatus(bPaid, cents(inv.total), s.had_refund);
    becamePaid = status === 'paid' && inv.pay_status !== 'paid';
    const { rows: [u] } = await c.query(
      `update invoices set amount_paid = $2, pay_status = $3,
              paid_at = case when $3 = 'paid' then coalesce(paid_at, now()) else null end, updated_at = now()
        where id = $1 returning *`, [inv.id, paid, status]);
    invoice = u;
    if (u.pay_status !== inv.pay_status) {
      await c.query(
        `insert into audit_log (actor_type, entity_type, entity_id, action, data) values ('system','invoice',$1,'payment_status_changed',$2)`,
        [inv.id, JSON.stringify({ from: inv.pay_status, to: u.pay_status, amount_paid: paid, total: Number(inv.total) })]);
    }
  }
  return { paid, booking, invoice, becamePaid };
}

/**
 * Record a verified payment / refund / reversal for a booking, inside an
 * existing transaction client `c`. Returns { payment, booking, invoice, duplicate, becamePaid }.
 */
export async function recordPaymentTx(c, { bookingId, actor, kind = 'payment', amount, method, reference, note,
  payment_date: paymentDate, verified, idempotency_key: idemKey, reverses_payment_id: reversesId }) {
  if (verified !== true) throw badRequest('payment_not_verified', 'Confirm that the money was received before recording it');
  if (!['payment', 'refund', 'reversal'].includes(kind)) throw badRequest('invalid_kind');

  if (idemKey) {
    const { rows: [dup] } = await c.query('select * from payments where idempotency_key = $1', [idemKey]);
    if (dup) {
      if (dup.booking_id !== bookingId) throw conflict('idempotency_key_reused');
      const { rows: [booking] } = await c.query('select * from bookings where id = $1', [bookingId]);
      const { rows: [invoice] } = await c.query(`select * from invoices where booking_id = $1 and doc_status = 'issued'`, [bookingId]);
      return { payment: dup, booking, invoice: invoice || null, duplicate: true, becamePaid: false };
    }
  }

  const { rows: [b] } = await c.query('select * from bookings where id = $1 for update', [bookingId]);
  if (!b) throw notFound('booking_not_found');
  const { rows: [inv] } = await c.query(`select * from invoices where booking_id = $1 and doc_status = 'issued' for update`, [b.id]);
  const { rows: [{ paid }] } = await c.query('select coalesce(sum(amount),0)::numeric(12,2) as paid from payments where booking_id = $1', [b.id]);
  const paidC = cents(paid);
  const totalC = cents(inv ? inv.total : b.total);
  const today = todayLocal();
  const date = paymentDate || today;
  if (date > today) throw badRequest('future_payment_date');

  let signed, original = null;
  if (kind === 'reversal') {
    if (!reversesId) throw badRequest('reverses_payment_required');
    const { rows: [p] } = await c.query('select * from payments where id = $1 and booking_id = $2', [reversesId, b.id]);
    if (!p || p.kind !== 'payment') throw notFound('payment_not_found');
    const { rowCount } = await c.query('select 1 from payments where reverses_payment_id = $1', [p.id]);
    if (rowCount) throw conflict('already_reversed', 'This payment was already reversed');
    if (paidC - cents(p.amount) < 0) throw conflict('reversal_exceeds_paid', 'Part of this payment was already refunded');
    original = p;
    signed = -Number(p.amount);
    method = p.method;
  } else {
    const amtC = cents(amount);
    if (!(amtC > 0)) throw badRequest('invalid_amount');
    if (!METHODS.includes(method)) throw badRequest('invalid_method');
    if (kind === 'payment') {
      if (paidC + amtC > totalC) {
        throw conflict('overpayment', 'The amount exceeds the outstanding balance',
          { outstanding: (totalC - paidC) / 100, currency: b.currency });
      }
      if (reference) {
        const { rowCount } = await c.query(
          `select 1 from payments p where p.booking_id = $1 and p.kind = 'payment' and p.method = $2 and lower(p.reference) = lower($3)
              and not exists (select 1 from payments r where r.reverses_payment_id = p.id)`, [b.id, method, reference]);
        if (rowCount) throw conflict('duplicate_payment', 'A payment with this transaction reference is already recorded');
      }
      signed = amtC / 100;
    } else {
      if (amtC > paidC) throw conflict('refund_exceeds_paid', 'Cannot refund more than was paid', { paid: paidC / 100 });
      signed = -amtC / 100;
    }
  }

  const { rows: [payment] } = await c.query(
    `insert into payments (booking_id, amount, method, reference, note, recorded_by, kind, currency, payment_date, invoice_id,
                           verified_by, verified_at, reverses_payment_id, idempotency_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$6, now(), $11, $12) returning *`,
    [b.id, signed, method, reference || null, note || null, actor.id, kind, b.currency, date, inv ? inv.id : null,
     original ? original.id : null, idemKey || null]);

  const state = await syncFinancialState(c, b.id);
  const data = { kind, amount: signed, method, reference: reference || null, payment_date: date, amount_paid: state.paid,
    payment_status: state.booking.payment_status, ...(original ? { reverses: original.id } : {}) };
  await audit(c, actor, 'booking', b.id, kind === 'payment' ? 'payment_recorded' : kind === 'refund' ? 'refund_recorded' : 'payment_reversed', data);
  if (inv) await audit(c, actor, 'invoice', inv.id, kind === 'payment' ? 'payment_recorded' : kind === 'refund' ? 'refund_recorded' : 'payment_reversed',
    { ...data, payment_id: payment.id, pay_status: state.invoice.pay_status });
  return { payment, booking: state.booking, invoice: state.invoice, duplicate: false, becamePaid: state.becamePaid };
}

/** Same as recordPaymentTx in its own transaction. Concurrent duplicates resolve to one row. */
export async function recordPayment(pool, args) {
  try {
    return await tx(pool, c => recordPaymentTx(c, args));
  } catch (err) {
    if (err.code === '23505' && args.idempotency_key) return tx(pool, c => recordPaymentTx(c, args));
    throw err;
  }
}
