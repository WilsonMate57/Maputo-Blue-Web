// ─────────────────────────────────────────────────────────────────────────────
// pdf-fonts.js — Brand typeface (DM Sans, same as the website) for generated
// PDFs. The TTF files live in server/assets/fonts (SIL Open Font License, see
// OFL.txt there) and are embedded (subset) in each document, so invoices and
// tickets look the same on every device and printer. If the files are missing
// the documents fall back to the built-in Helvetica instead of failing.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');
const FILES = { regular: 'DMSans-Regular.ttf', bold: 'DMSans-Bold.ttf', heavy: 'DMSans-ExtraBold.ttf' };
const FALLBACK = { regular: 'Helvetica', bold: 'Helvetica-Bold', heavy: 'Helvetica-Bold' };

let cache = null;
function load() {
  if (cache) return cache;
  try {
    // Read once into memory (also avoids file locks on Windows)
    cache = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, fs.readFileSync(path.join(DIR, f))]));
  } catch {
    cache = false;
  }
  return cache;
}

/** Register the brand fonts on a PDFKit document; returns the font names to use. */
export function brandFonts(doc) {
  const data = load();
  if (!data) return { ...FALLBACK };
  for (const [k, buf] of Object.entries(data)) doc.registerFont(`MB-${k}`, buf);
  return { regular: 'MB-regular', bold: 'MB-bold', heavy: 'MB-heavy' };
}
