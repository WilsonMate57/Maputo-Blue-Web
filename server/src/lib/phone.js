// ─────────────────────────────────────────────────────────────────────────────
// phone.js — Customer phone numbers, always stored in international form.
// Mozambique (+258) must be a mobile: 9 digits starting 82–87, the numbers
// WhatsApp works with. Other countries: country code + 8 to 15 digits in all.
// ─────────────────────────────────────────────────────────────────────────────

/** "+258 84 123 4567" / "841234567" / "0027 82 …" → "+258 84 123 4567" / "+2782…"; anything else → null. */
export function normalizeCustomerPhone(value) {
  const raw = String(value ?? '').trim().replace(/[\s().-]/g, '');
  let digits;
  if (/^\+\d+$/.test(raw)) digits = raw.slice(1);
  else if (/^00\d+$/.test(raw)) digits = raw.slice(2);
  else if (/^8[2-7]\d{7}$/.test(raw)) digits = '258' + raw;          // a local Mozambican mobile
  else return null;
  if (digits.startsWith('258')) {
    const m = /^258(8[2-7])(\d{3})(\d{4})$/.exec(digits);
    return m ? `+258 ${m[1]} ${m[2]} ${m[3]}` : null;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}
