// ─────────────────────────────────────────────────────────────────────────────
// dates.js — Calendar-date helpers. All business dates are plain 'YYYY-MM-DD'
// strings interpreted in the Africa/Maputo timezone (UTC+2, no DST).
// ─────────────────────────────────────────────────────────────────────────────

export const TZ = 'Africa/Maputo';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date in Maputo as 'YYYY-MM-DD'. */
export function todayLocal(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(s) {
  return new Date(s + 'T00:00:00Z').getUTCDay();
}

/** Start of a date (00:00 Maputo) as a JS Date. */
export function startOfDayLocal(s) {
  return new Date(s + 'T00:00:00+02:00');
}

export function monthDays(year, month) {
  const days = [];
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) days.push(d);
  return days;
}

/** Is 'MM-DD' of date s inside a season {from:'MM-DD', to:'MM-DD'} (may wrap the year)? */
export function inSeason(s, season) {
  const md = s.slice(5);
  return season.from <= season.to
    ? md >= season.from && md <= season.to
    : md >= season.from || md <= season.to;
}
