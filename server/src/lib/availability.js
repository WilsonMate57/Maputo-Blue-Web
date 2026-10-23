// ─────────────────────────────────────────────────────────────────────────────
// availability.js — Flexible availability model and capacity checks.
//
// pkg.availability = {
//   unit: 'pax' | 'unit' | 'room',  // what one booking consumes:
//                                   //   pax  → adults + children (boat trips, safaris)
//                                   //   unit → 1 per booking (private boats, vehicles)
//                                   //   room → ceil(guests / occupancy) per night
//   per_option: boolean,            // separate capacity per option (e.g. each boat)
//   default_capacity: int | null,   // null → not limited online (admin confirms manually)
//   occupancy: int,                 // guests per room (unit = 'room')
//   weekdays: [0..6] | null,        // operating weekdays; null → every day
//   seasons: [{from:'MM-DD', to:'MM-DD'}] | null,
//   min_lead_hours: int | null,     // overrides settings.booking.min_lead_hours
//   max_advance_days: int | null    // overrides settings.booking.max_advance_days
// }
// Day-level overrides (capacity / closed) live in availability_days.
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, inSeason, isDateString, startOfDayLocal, todayLocal, weekday, diffDays } from './dates.js';
import { badRequest, conflict } from './errors.js';

const UNITS = ['pax', 'unit', 'room'];

export function validateAvailability(a = {}) {
  const errs = [];
  const unit = a.unit || 'pax';
  if (!UNITS.includes(unit)) errs.push(`unit must be one of ${UNITS.join(', ')}`);
  const intOrNull = (v, name, min = 0) => {
    if (v === undefined || v === null || v === '') return null;
    if (!Number.isInteger(v) || v < min) { errs.push(`${name} must be an integer ≥ ${min}`); return null; }
    return v;
  };
  const weekdays = a.weekdays === undefined || a.weekdays === null ? null : a.weekdays;
  if (weekdays && (!Array.isArray(weekdays) || weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6))) errs.push('weekdays must be integers 0–6');
  const seasons = a.seasons === undefined || a.seasons === null ? null : a.seasons;
  if (seasons && (!Array.isArray(seasons) || seasons.some(s => !/^\d{2}-\d{2}$/.test(s.from) || !/^\d{2}-\d{2}$/.test(s.to)))) errs.push('seasons must be [{from:"MM-DD", to:"MM-DD"}]');
  const out = {
    unit,
    per_option: !!a.per_option,
    default_capacity: intOrNull(a.default_capacity, 'default_capacity'),
    occupancy: intOrNull(a.occupancy, 'occupancy', 1) || 2,
    weekdays: weekdays && weekdays.length ? [...new Set(weekdays)].sort() : null,
    seasons: seasons && seasons.length ? seasons : null,
    min_lead_hours: intOrNull(a.min_lead_hours, 'min_lead_hours'),
    max_advance_days: intOrNull(a.max_advance_days, 'max_advance_days', 1),
  };
  if (errs.length) throw badRequest('invalid_availability', 'Invalid availability settings', errs);
  return out;
}

export function resourceKeyFor(pkg, optionKey) {
  return pkg.availability.per_option && optionKey ? optionKey : '*';
}

export function quantityFor(pkg, adults, children) {
  const a = pkg.availability;
  const pax = adults + children;
  if (a.unit === 'unit') return 1;
  if (a.unit === 'room') return Math.max(1, Math.ceil(pax / (a.occupancy || 2)));
  return pax;
}

/**
 * Number of nights of a stay. Accommodation: the customer chooses between the
 * package minimum (pricing.nights, at least 1) and pricing.max_nights; when not
 * given, the minimum. Tours: 0.
 */
export function stayNights(pkg, requested) {
  if (pkg.kind !== 'accommodation') return 0;
  const min = Math.max(pkg.pricing.nights || 1, 1);
  const max = Math.max(pkg.pricing.max_nights || 30, min); // default: up to 30 nights
  if (requested === undefined || requested === null) return min;
  if (!Number.isInteger(requested) || requested < min || requested > max) {
    throw badRequest('invalid_selection', 'Invalid stay length', ['nights_range']);
  }
  return requested;
}

/** Days a booking occupies: tours → [start]; stays → one row per night. */
export function stayDays(pkg, start, nights) {
  const n = pkg.kind === 'accommodation' ? stayNights(pkg, nights) : 1;
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}

/** Check-out date (accommodation) or the tour date. */
export function endDateFor(pkg, start, nights) {
  return pkg.kind === 'accommodation' ? addDays(start, stayNights(pkg, nights)) : start;
}

/** Rules that do not depend on bookings. Returns a reason code or null. */
export function staticClosure(pkg, day, settings, now = new Date()) {
  const a = pkg.availability;
  const today = todayLocal(now);
  if (day < today) return 'past';
  const lead = a.min_lead_hours ?? settings.min_lead_hours ?? 0;
  if (lead > 0 && startOfDayLocal(day).getTime() - now.getTime() < lead * 3600e3) return 'lead_time';
  const maxAdv = a.max_advance_days ?? settings.max_advance_days ?? 365;
  if (diffDays(today, day) > maxAdv) return 'too_far';
  if (a.weekdays && !a.weekdays.includes(weekday(day))) return 'weekday_closed';
  if (a.seasons && !a.seasons.some(s => inSeason(day, s))) return 'out_of_season';
  return null;
}

/** SQL fragment: which bookings currently consume capacity. */
const ACTIVE_SQL = `(b.status = 'confirmed' or (b.status = 'pending' and $5::boolean and b.hold_expires_at > now()))`;

async function loadUsage(db, pkgId, resourceKey, from, to, holds, excludeBookingId = null) {
  const { rows } = await db.query(
    `select a.day, sum(a.quantity)::int as used
       from booking_allocations a join bookings b on b.id = a.booking_id
      where a.package_id = $1 and a.resource_key = $2 and a.day between $3 and $4
        and ${ACTIVE_SQL} and ($6::uuid is null or b.id <> $6)
      group by a.day`,
    [pkgId, resourceKey, from, to, holds, excludeBookingId]);
  return new Map(rows.map(r => [r.day, r.used]));
}

async function loadOverrides(db, pkgId, resourceKey, from, to) {
  const { rows } = await db.query(
    `select day, capacity, closed, note from availability_days
      where package_id = $1 and resource_key = $2 and day between $3 and $4`,
    [pkgId, resourceKey, from, to]);
  return new Map(rows.map(r => [r.day, r]));
}

function capacityFor(pkg, resourceKey, override) {
  if (override && override.capacity !== null && override.capacity !== undefined) return override.capacity;
  return pkg.availability.default_capacity;
}

function dayStatus({ closure, override, capacity, used }) {
  if (closure) return { status: 'closed', reason: closure };
  if (override && override.closed) return { status: 'closed', reason: 'blocked' };
  if (capacity === null || capacity === undefined) return { status: 'open', capacity: null, used, remaining: null };
  const remaining = Math.max(capacity - used, 0);
  if (remaining === 0) return { status: 'full', capacity, used, remaining };
  const limited = remaining <= Math.max(2, Math.ceil(capacity * 0.2));
  return { status: limited ? 'limited' : 'open', capacity, used, remaining };
}

/**
 * Calendar for a date range. Public callers get status + remaining only.
 * @returns {Array<{day, status, reason?, capacity, used, remaining, note?}>}
 */
export async function calendar(db, pkg, { from, to, optionKey = null, settings, now = new Date() }) {
  if (!isDateString(from) || !isDateString(to) || to < from || diffDays(from, to) > 400) throw badRequest('invalid_range');
  const rk = resourceKeyFor(pkg, optionKey);
  const holds = settings.pending_holds_capacity !== false;
  const [usage, overrides] = await Promise.all([
    loadUsage(db, pkg.id, rk, from, to, holds),
    loadOverrides(db, pkg.id, rk, from, to),
  ]);
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const override = overrides.get(d);
    const used = usage.get(d) || 0;
    const st = dayStatus({ closure: staticClosure(pkg, d, settings, now), override, capacity: capacityFor(pkg, rk, override), used });
    out.push({ day: d, resource_key: rk, ...st, ...(override && override.note ? { note: override.note } : {}) });
  }
  return out;
}

/**
 * Inside a transaction: lock the affected days, verify capacity and return the
 * allocations to insert. Throws 409 when a day is closed or full.
 * Advisory locks serialise concurrent bookings for the same package/day.
 */
export async function checkAndLock(client, pkg, { start, nights, optionKey, adults, children, settings, excludeBookingId = null, ignoreStatic = false, now = new Date() }) {
  const rk = resourceKeyFor(pkg, optionKey);
  const qty = quantityFor(pkg, adults, children);
  const days = stayDays(pkg, start, nights);
  for (const d of days) {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`${pkg.id}|${rk}|${d}`]);
  }
  const from = days[0], to = days[days.length - 1];
  const holds = settings.pending_holds_capacity !== false;
  const [usage, overrides] = await Promise.all([
    loadUsage(client, pkg.id, rk, from, to, holds, excludeBookingId),
    loadOverrides(client, pkg.id, rk, from, to),
  ]);
  for (const d of days) {
    const closure = ignoreStatic ? null : staticClosure(pkg, d, settings, now);
    const override = overrides.get(d);
    const st = dayStatus({ closure, override, capacity: capacityFor(pkg, rk, override), used: usage.get(d) || 0 });
    if (st.status === 'closed') throw conflict('date_unavailable', `Date ${d} is not available`, { day: d, reason: st.reason });
    if (st.remaining !== null && st.remaining !== undefined && st.remaining < qty) {
      throw conflict('insufficient_capacity', `Not enough capacity on ${d}`, { day: d, remaining: st.remaining, requested: qty });
    }
  }
  return days.map(d => ({ resource_key: rk, day: d, quantity: qty }));
}
