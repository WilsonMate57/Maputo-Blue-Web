// ─────────────────────────────────────────────────────────────────────────────
// card-ratings.js  —  Patch tour/accommodation cards on listing pages with
//                     live average ratings from Firestore.
//
// Loaded as <script type="module"> on any page that renders tour cards.
// Works alongside data-loader.js (IIFE) which renders cards asynchronously.
// A MutationObserver detects when cards are injected and patches them.
// ─────────────────────────────────────────────────────────────────────────────

import { loadRatingsMap } from './ratings-cache.js';

const LANG          = document.documentElement.lang.startsWith('en') ? 'en' : 'pt';
const REVIEWS_LABEL = LANG === 'en' ? 'reviews'      : 'avaliações';
const NO_REVIEWS    = LANG === 'en' ? 'No reviews yet' : 'Sem avaliações';

// ── Star HTML (mirrors data-loader.js starHTML) ───────────────────────────────
function starHTML(rating) {
  const full  = Math.floor(rating);
  const half  = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return (
    '<i class="bx bxs-star"></i>'.repeat(full) +
    (half ? '<i class="bx bxs-star-half"></i>' : '') +
    '<i class="bx bx-star"></i>'.repeat(empty)
  );
}

// ── Patch a single card ───────────────────────────────────────────────────────
function patchCard(card, ratingsMap) {
  const packageId    = card.dataset.id;
  if (!packageId) return;

  const starRatingEl = card.querySelector('.star-rating');
  if (!starRatingEl) return;

  // Avoid double-patching (tabs switch / filter re-renders inject fresh HTML)
  if (starRatingEl.dataset.fbPatched === '1') return;
  starRatingEl.dataset.fbPatched = '1';

  const valueEl = starRatingEl.querySelector('.rating-value');
  const countEl = starRatingEl.querySelector('.rating-count');
  const data    = ratingsMap.get(packageId);

  // Remove existing static star icons
  starRatingEl.querySelectorAll('i.bx').forEach(el => el.remove());

  if (!data) {
    // No Firestore reviews — show empty state
    if (valueEl) valueEl.textContent = '';
    if (countEl) countEl.textContent = NO_REVIEWS;
    return;
  }

  const { avg, count } = data;

  // Inject live star icons at the start of the container
  starRatingEl.insertAdjacentHTML('afterbegin', starHTML(avg));
  if (valueEl) valueEl.textContent = avg.toFixed(1);
  if (countEl) countEl.textContent = `(${count} ${REVIEWS_LABEL})`;
}

// ── Patch all cards currently in the DOM ─────────────────────────────────────
function patchAll(ratingsMap) {
  document.querySelectorAll('article[data-id]').forEach(card => patchCard(card, ratingsMap));
}

// ── Main init ─────────────────────────────────────────────────────────────────
async function initCardRatings() {
  let ratingsMap;
  try {
    ratingsMap = await loadRatingsMap();
  } catch (err) {
    console.warn('[card-ratings] Could not load ratings from Firestore:', err);
    return;
  }

  // Patch cards that are already rendered
  patchAll(ratingsMap);

  // Watch every card grid for DOM changes caused by:
  //  • data-loader.js replacing skeleton HTML with real cards
  //  • category tab switches / filter chip clicks (replace grid innerHTML)
  const grids = document.querySelectorAll([
    '#tours-grid',
    '#accommodations-grid',
    '#related-tours',
    '#featured-experiences .tours-grid',
  ].join(', '));

  if (grids.length) {
    const observer = new MutationObserver(() => patchAll(ratingsMap));
    grids.forEach(grid => observer.observe(grid, { childList: true }));
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCardRatings);
} else {
  initCardRatings();
}
