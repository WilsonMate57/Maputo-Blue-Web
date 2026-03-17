// ─────────────────────────────────────────────────────────────────────────────
// ratings-cache.js  —  Fetch all Firestore reviews once, compute per-package
//                      averages, and cache the result for the session.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

/** @type {Map<string, {avg: number, count: number}> | null} */
let _cache = null;

/**
 * Returns a Map from packageId → { avg, count }.
 * Fetches from Firestore on first call; returns cached result on subsequent calls.
 */
export async function loadRatingsMap() {
  if (_cache) return _cache;

  const snap = await getDocs(collection(db, 'reviews'));

  // First pass: accumulate sums and counts per packageId
  const agg = new Map(); // packageId → { sum, count }
  snap.forEach(doc => {
    const { packageId, rating } = doc.data();
    if (!packageId || typeof rating !== 'number') return;
    const entry = agg.get(packageId) || { sum: 0, count: 0 };
    entry.sum   += rating;
    entry.count += 1;
    agg.set(packageId, entry);
  });

  // Second pass: compute averages
  _cache = new Map();
  agg.forEach(({ sum, count }, id) => {
    _cache.set(id, {
      avg:   Math.round((sum / count) * 10) / 10,
      count,
    });
  });

  return _cache;
}
