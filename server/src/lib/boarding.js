// ─────────────────────────────────────────────────────────────────────────────
// boarding.js — Who may board. A ticket with a QR code exists only for a
// confirmed booking paid in full, or one the team authorised with a reason.
// Everything else is a receipt that says, in large type, it is not a ticket.
// ─────────────────────────────────────────────────────────────────────────────
import { enqueueMail } from './mailer.js';

const cents = n => Math.round(Number(n || 0) * 100);

export const isPaidInFull = b => b.payment_status === 'paid' || (cents(b.total) > 0 && cents(b.amount_paid) >= cents(b.total));

export const amountDue = b => Math.max(0, cents(b.total) - cents(b.amount_paid)) / 100;

/**
 * request   pending: not confirmed, not a ticket
 * unpaid    confirmed, money still missing, no exception
 * boarding  confirmed and paid in full, or authorised by the team
 * closed    cancelled, rejected or completed
 */
export function boardingState(b) {
  if (b.status === 'pending') return 'request';
  if (b.status !== 'confirmed') return 'closed';
  return isPaidInFull(b) || b.boarding_override_at ? 'boarding' : 'unpaid';
}

/** After a payment: when the booking has just become paid in full, send the ticket. */
export async function sendTicketIfNowPaid(db, { before, booking, invoice, becamePaid, notify }) {
  if (notify === false || booking.status !== 'confirmed' || isPaidInFull(before) || !isPaidInFull(booking)) return false;
  // The "invoice paid" e-mail already carries the ticket; without an invoice the ticket goes alone
  if (becamePaid && invoice) return false;
  await enqueueMail(db, { key: `booking:${booking.id}:ticket:paid`, to: booking.customer_email, template: 'booking_ticket', locale: booking.locale,
    data: { reference: booking.reference, customer_name: booking.customer_name, status: booking.status, state: 'boarding', attach_ticket_booking: booking.id } });
  return true;
}
