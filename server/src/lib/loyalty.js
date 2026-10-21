// ─────────────────────────────────────────────────────────────────────────────
// loyalty.js — Repeat-customer eligibility, computed only from verified,
// completed bookings in the database (+ audited manual adjustments).
// Guests and unverified accounts are never eligible when the program
// requires a verified e-mail, so duplicate accounts cannot farm discounts:
// bookings are matched to the verified e-mail, which is unique per account.
// ─────────────────────────────────────────────────────────────────────────────
import { getSetting } from './catalog.js';

export async function loyaltyStatus(db, user) {
  const s = await getSetting(db, 'loyalty');
  const base = {
    enabled: !!s.enabled, eligible: false, completed: 0,
    required: s.min_completed_bookings, kind: s.kind, value: s.value,
    max_discount: s.max_discount ?? null, categories: s.categories || null,
    combinable_with_promotions: !!s.combinable_with_promotions, window_months: s.window_months,
  };
  if (!s.enabled || !user) return base;
  const verified = !!user.email_verified_at;
  if (s.require_verified_email !== false && !verified) return { ...base, reason: 'email_not_verified' };

  const { rows } = await db.query(
    `select
       (select count(*)::int from bookings b
         where b.status = 'completed'
           and (b.user_id = $1 or ($3 and lower(b.customer_email) = lower($2)))
           and ($4::int is null or b.completed_at > now() - make_interval(months => $4::int))) as completed,
       (select coalesce(sum(delta), 0)::int from loyalty_adjustments where user_id = $1) as adjust`,
    [user.id, user.email, verified, s.window_months || null]);
  const completed = Math.max(rows[0].completed + rows[0].adjust, 0);
  return { ...base, completed, eligible: completed >= (s.min_completed_bookings || 1) };
}
