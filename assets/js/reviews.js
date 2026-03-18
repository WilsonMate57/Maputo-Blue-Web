// ─────────────────────────────────────────────────────────────────────────────
// reviews.js  —  Firebase/Firestore reviews & ratings system
// Imported as <script type="module"> in package.html pages.
//
// @copyright  2026 Maputo Blue. All rights reserved.
// @author     Wilson Creative Studio
// @license    Proprietary — Unauthorised use or distribution is prohibited.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase.js';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

// ── Language ──────────────────────────────────────────────────────────────────
const LANG = document.documentElement.lang.startsWith('en') ? 'en' : 'pt';

// ── Strings ───────────────────────────────────────────────────────────────────
const S = {
  pt: {
    sectionTitle:  'Avaliações',
    avgLabel:      'Média',
    totalLabel:    rev => rev === 1 ? '1 avaliação' : `${rev} avaliações`,
    noReviews:     'Ainda não há avaliações. Seja o primeiro a partilhar a sua experiência!',
    formTitle:     'Deixe a sua avaliação',
    labelName:     'Nome',
    placeholderName: 'O seu nome',
    labelRating:   'Classificação',
    labelComment:  'Comentário',
    placeholderComment: 'Descreva a sua experiência…',
    submitBtn:     'Enviar avaliação',
    submitting:    'A enviar…',
    successMsg:    'Obrigado pela sua avaliação!',
    errorMsg:      'Erro ao enviar. Tente novamente.',
    errorRequired: 'Por favor, preencha todos os campos e seleccione uma classificação.',
    anonymous:     'Anónimo',
  },
  en: {
    sectionTitle:  'Reviews',
    avgLabel:      'Average',
    totalLabel:    rev => rev === 1 ? '1 review' : `${rev} reviews`,
    noReviews:     'No reviews yet. Be the first to share your experience!',
    formTitle:     'Leave a review',
    labelName:     'Name',
    placeholderName: 'Your name',
    labelRating:   'Rating',
    labelComment:  'Comment',
    placeholderComment: 'Describe your experience…',
    submitBtn:     'Submit review',
    submitting:    'Submitting…',
    successMsg:    'Thank you for your review!',
    errorMsg:      'Could not submit. Please try again.',
    errorRequired: 'Please fill in all fields and select a rating.',
    anonymous:     'Anonymous',
  },
}[LANG];

// ── Star helpers ──────────────────────────────────────────────────────────────
function starsHTML(rating, interactive = false) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    const filled = i <= Math.round(rating);
    if (interactive) {
      html += `<button type="button" class="star-pick${filled ? ' active' : ''}" data-value="${i}" aria-label="${i} ${LANG === 'en' ? 'star' : 'estrela'}${i > 1 ? 's' : ''}">
        <i class='bx bxs-star'></i>
      </button>`;
    } else {
      html += `<i class='bx bx${filled ? 's' : '-'}-star reviews-star${filled ? ' filled' : ''}'></i>`;
    }
  }
  return html;
}

// ── Star picker factory ───────────────────────────────────────────────────────
function buildStarPicker() {
  const el = document.createElement('div');
  el.className = 'star-picker';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', S.labelRating);
  el.innerHTML = starsHTML(0, true);
  let current = 0;

  function update(val, hover = false) {
    el.querySelectorAll('.star-pick').forEach((btn, i) => {
      const on = i < val;
      btn.classList.toggle('active', on);
      btn.querySelector('i').className = 'bx bxs-star';
      btn.classList.toggle('hover', hover && on);
    });
  }

  el.addEventListener('mouseover', e => {
    const btn = e.target.closest('.star-pick');
    if (btn) update(+btn.dataset.value, true);
  });
  el.addEventListener('mouseleave', () => update(current));
  el.addEventListener('click', e => {
    const btn = e.target.closest('.star-pick');
    if (!btn) return;
    current = +btn.dataset.value;
    update(current);
  });

  return {
    element:   el,
    getValue:  () => current,
    reset:     () => { current = 0; update(0); },
  };
}

// ── Render aggregate ──────────────────────────────────────────────────────────
function renderAggregate(reviews) {
  const container = document.getElementById('reviews-aggregate');
  if (!container) return;
  const count = reviews.length;
  if (!count) {
    container.innerHTML = '';
    return;
  }
  const avg = reviews.reduce((s, r) => s + r.rating, 0) / count;
  const rounded = Math.round(avg * 10) / 10;
  container.innerHTML = `
    <div class="reviews-aggregate">
      <div class="reviews-avg-score">${rounded.toFixed(1)}</div>
      <div class="reviews-avg-right">
        <div class="reviews-avg-stars">${starsHTML(avg)}</div>
        <div class="reviews-avg-label">${S.avgLabel} · ${S.totalLabel(count)}</div>
      </div>
    </div>`;
}

// ── Render review list ─────────────────────────────────────────────────────────
function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString(LANG === 'en' ? 'en-GB' : 'pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderReviews(reviews) {
  const list = document.getElementById('fb-reviews-list');
  if (!list) return;
  if (!reviews.length) {
    list.innerHTML = `<p class="reviews-empty">${S.noReviews}</p>`;
    return;
  }
  list.innerHTML = reviews.map(r => `
    <div class="review-card">
      <div class="review-card__header">
        <div class="review-card__avatar">${(r.name || S.anonymous).charAt(0).toUpperCase()}</div>
        <div class="review-card__meta">
          <span class="review-card__name">${escHtml(r.name || S.anonymous)}</span>
          <span class="review-card__date">${formatDate(r.createdAt)}</span>
        </div>
        <div class="review-card__stars">${starsHTML(r.rating)}</div>
      </div>
      <p class="review-card__comment">${escHtml(r.comment)}</p>
    </div>`).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Load reviews from Firestore ───────────────────────────────────────────────
async function loadReviews(packageId) {
  let reviews = [];
  try {
    // Attempt ordered query — requires composite index on (packageId, createdAt)
    const q = query(
      collection(db, 'reviews'),
      where('packageId', '==', packageId),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    snap.forEach(doc => reviews.push({ id: doc.id, ...doc.data() }));
  } catch (e) {
    // Composite index not yet created — fallback to simple where + client-side sort
    if (e.code === 'failed-precondition' || e.code === 'unimplemented') {
      const q2 = query(collection(db, 'reviews'), where('packageId', '==', packageId));
      const snap2 = await getDocs(q2);
      snap2.forEach(doc => reviews.push({ id: doc.id, ...doc.data() }));
      reviews.sort((a, b) => {
        const ta = a.createdAt?.seconds ?? 0;
        const tb = b.createdAt?.seconds ?? 0;
        return tb - ta;
      });
    } else {
      throw e;
    }
  }
  return reviews;
}

// ── Render review form ─────────────────────────────────────────────────────────
function renderForm(packageId, onSubmitSuccess) {
  const container = document.getElementById('fb-review-form');
  if (!container) return;

  const picker = buildStarPicker();

  container.innerHTML = `
    <div class="review-form-wrap">
      <h3 class="review-form-title">${S.formTitle}</h3>
      <form id="review-form" novalidate>
        <div class="review-form-row">
          <label class="review-form-label" for="review-name">${S.labelName}</label>
          <input
            class="booking-input review-form-input"
            type="text"
            id="review-name"
            name="name"
            placeholder="${S.placeholderName}"
            maxlength="80"
            autocomplete="name"
          >
        </div>
        <div class="review-form-row">
          <label class="review-form-label">${S.labelRating}</label>
          <div id="review-star-picker"></div>
        </div>
        <div class="review-form-row">
          <label class="review-form-label" for="review-comment">${S.labelComment}</label>
          <textarea
            class="booking-input review-form-textarea"
            id="review-comment"
            name="comment"
            placeholder="${S.placeholderComment}"
            rows="4"
            maxlength="1000"
          ></textarea>
        </div>
        <p class="review-form-feedback" id="review-feedback" aria-live="polite"></p>
        <button type="submit" class="btn-primary-mb review-form-submit" id="review-submit">
          ${S.submitBtn}
        </button>
      </form>
    </div>`;

  // Mount star picker
  document.getElementById('review-star-picker').appendChild(picker.element);

  const form       = document.getElementById('review-form');
  const feedback   = document.getElementById('review-feedback');
  const submitBtn  = document.getElementById('review-submit');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name    = document.getElementById('review-name').value.trim();
    const comment = document.getElementById('review-comment').value.trim();
    const rating  = picker.getValue();

    if (!name || !comment || !rating) {
      showFeedback(S.errorRequired, 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = S.submitting;

    try {
      await addDoc(collection(db, 'reviews'), {
        packageId,
        name,
        rating,
        comment,
        createdAt: serverTimestamp(),
      });
      form.reset();
      picker.reset();
      showFeedback(S.successMsg, 'success');
      submitBtn.disabled = false;
      submitBtn.textContent = S.submitBtn;
      onSubmitSuccess();
    } catch (err) {
      console.error('Review submission failed:', err);
      showFeedback(S.errorMsg, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = S.submitBtn;
    }
  });

  function showFeedback(msg, type) {
    feedback.textContent = msg;
    feedback.className = `review-form-feedback visible ${type}`;
    setTimeout(() => {
      feedback.className = 'review-form-feedback';
      feedback.textContent = '';
    }, 4000);
  }
}

// ── Update header rating display ──────────────────────────────────────────────
function updateHeaderRating(reviews) {
  const ratingEl = document.getElementById('package-rating');
  const countEl  = document.getElementById('package-reviews-count');
  if (!reviews.length) {
    if (ratingEl) ratingEl.innerHTML = '';
    if (countEl)  countEl.textContent = '';
    return;
  }
  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  if (ratingEl) ratingEl.innerHTML = starsHTML(avg);
  if (countEl)  countEl.textContent = `(${reviews.length})`;
}

// ── Main init ──────────────────────────────────────────────────────────────────
async function initReviews() {
  // Resolve packageId from URL  (?id=inhaca-island-daytrip)
  const packageId = new URLSearchParams(window.location.search).get('id');
  if (!packageId) return;

  // Render form immediately (doesn't need data)
  renderForm(packageId, refresh);

  await refresh();

  async function refresh() {
    try {
      const reviews = await loadReviews(packageId);
      renderAggregate(reviews);
      renderReviews(reviews);
      updateHeaderRating(reviews);
    } catch (err) {
      console.error('Failed to load reviews:', err);
    }
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReviews);
} else {
  initReviews();
}
