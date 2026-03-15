/**
 * data-loader.js
 * Loads JSON data and renders dynamic card grids + sliders.
 * Supports bilingual output — reads `<html lang="">` and uses
 * `field_en` JSON fallbacks when lang is English.
 */
(function () {
  'use strict';

  /* ── Language & Path resolution ─────────────────────────── */
  const LANG    = document.documentElement.lang.startsWith('en') ? 'en' : 'pt';
  const pth     = window.location.pathname;
  const IN_EN   = pth.includes('/en/');
  const IN_PAGES = pth.includes('/pages/') && !IN_EN;

  const DATA_BASE   = (IN_EN || IN_PAGES) ? '../data/' : './data/';
  // From root: link to pages/package.html | from /pages/ or /en/: link to package.html
  const PAGES_PREFIX = (IN_EN || IN_PAGES) ? '' : 'pages/';

  /* ── i18n string table ───────────────────────────────────── */
  const STR = {
    pt: {
      from:       'A partir de',
      per_person: '/pessoa',
      per_night:  '/noite',
      book:       'Reservar',
      details:    'Ver Detalhes',
      no_results: 'Nenhum resultado encontrado.',
      loading:    'A carregar...',
      reviews:    'avaliações',
      easy:       'Fácil',
    },
    en: {
      from:       'From',
      per_person: '/person',
      per_night:  '/night',
      book:       'Book Now',
      details:    'View Details',
      no_results: 'No results found.',
      loading:    'Loading...',
      reviews:    'reviews',
      easy:       'Easy',
    },
  };

  /** Get a translated UI string */
  function t(key) { return STR[LANG][key] || STR.pt[key] || key; }

  /** Get a bilingual field: prefer field_en when LANG=en, fallback to base field */
  function tf(item, field) {
    if (LANG === 'en') return item[field + '_en'] || item[field] || '';
    return item[field] || '';
  }

  /** Get a bilingual array field */
  function tfa(item, field) {
    if (LANG === 'en') return item[field + '_en'] || item[field] || [];
    return item[field] || [];
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  async function fetchJSON(file) {
    try {
      const res = await fetch(DATA_BASE + file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[data-loader] Failed to load ${file}:`, err.message);
      return [];
    }
  }

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

  function badgeClass(badge) {
    const map = { 'Mais Popular': '', 'Best Seller': '', 'Premium': 'tour-badge--navy',
                  'Eco Lodge': 'tour-badge--green', 'Top Rated': 'tour-badge--green' };
    return map[badge] || '';
  }

  /* ── Tour Card ───────────────────────────────────────────── */
  function buildTourCard(tour) {
    const title   = tf(tour, 'title');
    const desc    = tf(tour, 'description');
    const imgSrc  = (tour.images && tour.images[0]) || '';
    const imgTag  = imgSrc ? `<img src="${imgSrc}" alt="${title}" loading="lazy">` : '';
    const badge   = tour.badge ? `<span class="tour-badge ${badgeClass(tour.badge)}">${tour.badge}</span>` : '';
    const detailUrl = `${PAGES_PREFIX}package.html?id=${tour.id}`;

    return `
<article class="tour-card" data-category="${tour.category}" data-id="${tour.id}">
  <div class="tour-card-image">
    ${imgTag}
    <div class="tour-card-badge">${badge}</div>
  </div>
  <div class="tour-card-body">
    <h3 class="tour-card-title">${title}</h3>
    <div class="tour-card-meta">
      <span class="tour-meta-item"><i class='bx bx-map-pin'></i>${tour.location}</span>
      <span class="tour-meta-item"><i class='bx bx-time-five'></i>${tf(tour, 'duration')}</span>
      <span class="tour-meta-item"><i class='bx bx-group'></i>${tf(tour, 'group_size')}</span>
    </div>
    <p class="tour-card-description">${desc}</p>
    <div class="tour-card-footer">
      <div class="tour-card-price">
        <span class="price-from">${t('from')}</span>
        <span class="price-value">${tour.currency} ${tour.price_from}<span>${t('per_person')}</span></span>
        <div class="star-rating">
          ${starHTML(tour.rating)}
          <span class="rating-value">${tour.rating}</span>
          <span class="rating-count">(${tour.reviews_count || 0})</span>
        </div>
      </div>
      <a href="${detailUrl}" class="tour-card-btn" aria-label="${t('book')} ${title}">${t('book')}</a>
    </div>
  </div>
</article>`;
  }

  /* ── Accommodation Card ──────────────────────────────────── */
  function buildAccommodationCard(acc) {
    const name     = acc.name_en && LANG === 'en' ? acc.name_en : acc.name;
    const desc     = tf(acc, 'description');
    const imgSrc   = (acc.images && acc.images[0]) || '';
    const imgTag   = imgSrc ? `<img src="${imgSrc}" alt="${name}" loading="lazy">` : '';
    const amenities = (acc.amenities || []).slice(0, 5)
      .map(a => `<span class="amenity-chip"><i class='bx bx-check'></i>${a}</span>`)
      .join('');

    return `
<article class="accommodation-card" data-category="${acc.category}" data-id="${acc.id}">
  <div class="accommodation-card-image">${imgTag}</div>
  <div class="accommodation-card-body">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
      <h3 class="accommodation-card-name">${name}</h3>
      ${acc.badge ? `<span class="tour-badge ${badgeClass(acc.badge)}">${acc.badge}</span>` : ''}
    </div>
    <div class="tour-meta-item" style="margin-bottom:6px;"><i class='bx bx-map-pin'></i>${acc.location}</div>
    <div class="star-rating" style="margin-bottom:10px;">
      ${starHTML(acc.rating)}
      <span class="rating-value">${acc.rating}</span>
      <span class="rating-count">(${acc.reviews_count || 0})</span>
    </div>
    <p style="font-size:.875rem;color:var(--text-muted);line-height:1.6;margin-bottom:12px;">${desc}</p>
    <div class="accommodation-amenities">${amenities}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;padding-top:14px;border-top:1px solid var(--border-light);">
      <div>
        <span class="price-from" style="display:block;">${t('from')}</span>
        <span class="price-value">${acc.currency} ${acc.price_per_night}<span>${t('per_night')}</span></span>
      </div>
      <a href="${PAGES_PREFIX}package.html?id=${acc.id}&type=accommodation" class="tour-card-btn">${t('details')}</a>
    </div>
  </div>
</article>`;
  }

  /* ── Featured Experiences (homepage tabs) ────────────────── */
  async function initFeaturedExperiences() {
    const section = document.querySelector('#featured-experiences');
    if (!section) return;

    const tabsEl = section.querySelector('.category-tabs');
    const gridEl = section.querySelector('.tours-grid');
    if (!tabsEl || !gridEl) return;

    const [tours, accs] = await Promise.all([
      fetchJSON('tours.json'),
      fetchJSON('accommodations.json'),
    ]);

    const ALL_DATA = {
      'island-daytrips':  tours.filter(t => t.category === 'island-daytrips'),
      'beach-daytrips':   tours.filter(t => t.category === 'beach-daytrips'),
      'safaris':          tours.filter(t => t.category === 'safaris'),
      'transfers':        tours.filter(t => t.category === 'transfers'),
      'maputo-city-tour': tours.filter(t => t.category === 'maputo-city-tour'),
      'sea-activities':   tours.filter(t => t.category === 'sea-activities'),
      'accommodation':    accs,
    };

    function renderGrid(category) {
      const items = ALL_DATA[category] || [];
      if (!items.length) {
        gridEl.innerHTML = `<p style="color:var(--text-muted);padding:24px 0;">${t('no_results')}</p>`;
        return;
      }
      gridEl.innerHTML = items
        .map(item => category === 'accommodation'
          ? buildAccommodationCard(item)
          : buildTourCard(item))
        .join('');
    }

    tabsEl.querySelectorAll('.category-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabsEl.querySelectorAll('.category-tab').forEach(tb => tb.classList.remove('active'));
        tab.classList.add('active');
        renderGrid(tab.dataset.category);
      });
    });

    const firstActive = tabsEl.querySelector('.category-tab.active');
    if (firstActive) renderGrid(firstActive.dataset.category);
  }

  /* ── Full Tours Grid (tours.html / en/tours.html) ────────── */
  async function initToursPage() {
    const grid  = document.querySelector('#tours-grid');
    const chips = document.querySelectorAll('.filter-chip[data-category]');
    if (!grid) return;

    const tours = await fetchJSON('tours.json');

    function renderTours(category) {
      const items = category === 'all' ? tours : tours.filter(t => t.category === category);
      grid.innerHTML = items.length
        ? items.map(buildTourCard).join('')
        : `<p style="color:var(--text-muted);padding:24px 0;">${t('no_results')}</p>`;
    }

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderTours(chip.dataset.category);
      });
    });

    renderTours('all');
  }

  /* ── Accommodations Page ─────────────────────────────────── */
  async function initAccommodationsPage() {
    const grid  = document.querySelector('#accommodations-grid');
    const chips = document.querySelectorAll('.filter-chip[data-category]');
    if (!grid) return;

    const accs = await fetchJSON('accommodations.json');

    function renderAccs(category) {
      const items = category === 'all' ? accs : accs.filter(a => a.category === category);
      grid.innerHTML = items.length
        ? items.map(buildAccommodationCard).join('')
        : `<p style="color:var(--text-muted);padding:24px 0;">${t('no_results')}</p>`;
    }

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderAccs(chip.dataset.category);
      });
    });

    renderAccs('all');
  }

  /* ── Package Detail Page ─────────────────────────────────── */
  async function initPackagePage() {
    const el = document.querySelector('#package-detail');
    if (!el) return;

    const params = new URLSearchParams(window.location.search);
    const id     = params.get('id');
    const type   = params.get('type') || 'tour';

    if (!id) { el.innerHTML = '<p class="text-muted p-4">Package not found.</p>'; return; }

    const data = type === 'accommodation'
      ? await fetchJSON('accommodations.json')
      : await fetchJSON('tours.json');

    const item = data.find(d => d.id === id);
    if (!item) { el.innerHTML = '<p class="text-muted p-4">Package not found.</p>'; return; }

    renderPackageDetail(item, type);
  }

  function renderPackageDetail(item, type) {
    const title    = tf(item, 'title') || item.name || '';
    const price    = item.price_from || item.price_per_night || 0;
    const currency = item.currency || 'USD';

    document.title = `${title} — Maputo Blue`;

    const bcEl = document.querySelector('#pkg-breadcrumb-title');
    if (bcEl) bcEl.textContent = title;

    const titleEl = document.querySelector('#package-title-h1');
    if (titleEl) titleEl.textContent = title;

    const locationEl = document.querySelector('#package-location');
    if (locationEl) locationEl.textContent = item.location;

    const priceEl = document.querySelector('#package-price');
    if (priceEl) priceEl.textContent = `${currency} ${price}`;

    const mobilePriceEl = document.querySelector('#mobile-price');
    if (mobilePriceEl) mobilePriceEl.textContent = `${currency} ${price}`;

    const ratingEl = document.querySelector('#package-rating');
    if (ratingEl) ratingEl.innerHTML = starHTML(item.rating);

    const bookingRatingEl = document.querySelector('#booking-rating');
    if (bookingRatingEl) bookingRatingEl.innerHTML = starHTML(item.rating);

    const reviewsCount = item.reviews_count || (item.reviews ? item.reviews.length : 0);
    document.querySelectorAll('#package-reviews-count, #booking-reviews-count').forEach(el => {
      el.textContent = `(${reviewsCount} ${t('reviews')})`;
    });

    if (window._pkgSetPrice) window._pkgSetPrice(price, currency);

    // WhatsApp messages
    const waBookMsg  = LANG === 'en'
      ? `Hello Maputo Blue 👋\n\nI would like to reserve the following tour:\n\nTour: ${title}\n\nPlease confirm availability.`
      : `Olá Maputo Blue 👋\n\nGostaria de reservar o seguinte tour:\n\nTour: ${title}\n\nPor favor confirme a disponibilidade.`;
    const waQaMsg    = LANG === 'en'
      ? `Hello, I have a question about the tour: ${title}`
      : `Olá, tenho uma pergunta sobre o tour: ${title}`;
    const waBase = 'https://wa.me/258847121666?text=';

    document.querySelectorAll('#booking-whatsapp-btn, #mobile-booking-btn').forEach(el => {
      el.href = waBase + encodeURIComponent(waBookMsg);
    });
    const hostBtn = document.querySelector('#host-whatsapp-btn');
    if (hostBtn) hostBtn.href = waBase + encodeURIComponent(waQaMsg);

    // Gallery
    const images   = item.images || [];
    const imgMain  = document.querySelector('#gallery-img-main');
    const imgSide1 = document.querySelector('#gallery-img-side1');
    const imgSide2 = document.querySelector('#gallery-img-side2');
    const galCounter = document.querySelector('#gallery-counter');

    if (images[0] && imgMain)  { imgMain.src  = images[0]; imgMain.alt  = title; }
    if (imgSide1) { imgSide1.src = images[1] || images[0] || ''; imgSide1.alt = `${title} — 2`; }
    if (imgSide2) { imgSide2.src = images[2] || images[0] || ''; imgSide2.alt = `${title} — 3`; }
    if (galCounter) galCounter.textContent = images.length ? `${images.length} ${LANG === 'en' ? 'photos' : 'fotos'}` : '';

    if (window._pkgInitLightbox) {
      window._pkgInitLightbox(images.length ? images : [imgMain ? imgMain.src : '']);
    }

    // Overview bar
    const setEl = (id, val) => { const el = document.querySelector(id); if (el && val) el.textContent = val; };
    setEl('#package-duration',   tf(item, 'duration'));
    setEl('#package-group',      tf(item, 'group_size'));
    setEl('#package-languages',  Array.isArray(item.languages) ? item.languages.join(', ') : item.languages);
    setEl('#package-difficulty', item.difficulty_en && LANG === 'en' ? item.difficulty_en : (item.difficulty || t('easy')));

    // Description
    const descEl = document.querySelector('#package-description');
    if (descEl) descEl.textContent = tf(item, 'description');

    // Highlights
    const hlEl = document.querySelector('#package-highlights');
    if (hlEl && (item.highlights || item.highlights_en)) {
      hlEl.innerHTML = tfa(item, 'highlights').map(h => `
        <li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;font-size:.9375rem;">
          <i class='bx bxs-check-circle' style="color:var(--sea-green);margin-top:2px;flex-shrink:0;font-size:1.1rem;"></i>
          <span style="color:var(--text-body);">${h}</span>
        </li>`).join('');
    }

    // Included
    const inclEl = document.querySelector('#package-included');
    if (inclEl && (item.included || item.included_en)) {
      inclEl.innerHTML = tfa(item, 'included').map(i => `
        <div class="included-item"><i class='bx bx-check-circle'></i><span>${i}</span></div>`).join('');
    }

    // Excluded
    const exclEl = document.querySelector('#package-excluded');
    if (exclEl && (item.excluded || item.excluded_en)) {
      exclEl.innerHTML = tfa(item, 'excluded').map(i => `
        <div class="excluded-item"><i class='bx bx-x-circle'></i><span>${i}</span></div>`).join('');
    }

    // Itinerary
    const itinEl = document.querySelector('#package-itinerary');
    if (itinEl && (item.itinerary || item.itinerary_en)) {
      itinEl.innerHTML = tfa(item, 'itinerary').map((step, idx) => `
        <div class="itin-item">
          <button class="itin-trigger" aria-expanded="${idx === 0 ? 'true' : 'false'}">
            <div class="itin-step-badge">${idx + 1}</div>
            <span class="itin-trigger__time">${step.time}</span>
            <span class="itin-trigger__title">${LANG === 'en' ? (step.title_en || step.title) : step.title}</span>
            <i class='bx bx-chevron-down itin-trigger__chevron'></i>
          </button>
          <div class="itin-body${idx === 0 ? ' open' : ''}">
            <p>${LANG === 'en' ? (step.description_en || step.description) : step.description}</p>
          </div>
        </div>`).join('');
    }

    // Reviews
    const revEl = document.querySelector('#package-reviews');
    if (revEl && item.reviews) {
      revEl.innerHTML = item.reviews.map(r => `
        <div style="background:var(--light-bg);border-radius:var(--radius-md);padding:20px;margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--sea-green),var(--primary));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">${r.author[0]}</div>
            <div>
              <strong style="display:block;font-size:.9rem;color:var(--primary);">${r.author}</strong>
              <small style="color:var(--text-muted);">${r.date}</small>
            </div>
            <div class="star-rating ms-auto">${starHTML(r.rating)}</div>
          </div>
          <p style="font-size:.875rem;color:var(--text-body);line-height:1.65;margin:0;">${r.text}</p>
        </div>`).join('');
    }
  }

  /* ── Testimonials (homepage) ─────────────────────────────── */
  async function initTestimonials() {
    const track = document.querySelector('#testimonials-track');
    if (!track) return;

    const data = await fetchJSON('testimonials.json');
    if (!data.length) return;

    track.innerHTML = data.map(t => `
      <div class="testimonial-card">
        <div class="testimonial-quote"><i class='bx bxs-quote-left'></i></div>
        <p class="testimonial-text">"${LANG === 'en' ? (t.text_en || t.text) : t.text}"</p>
        <div class="testimonial-author">
          <div class="testimonial-avatar" style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--sea-green),var(--primary));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;flex-shrink:0;">${t.name[0]}</div>
          <div class="testimonial-author-info">
            <strong>${t.name}</strong>
            <small>${t.profession}</small>
          </div>
        </div>
        <div class="testimonial-footer">
          <div class="star-rating">${starHTML(t.rating)}</div>
          <a href="${t.source_url}" class="testimonial-source" rel="noopener"><i class='bx bx-star'></i>${t.source}</a>
        </div>
      </div>`).join('');

    const indicatorsEl = document.querySelector('#testimonials-indicators');
    if (indicatorsEl) {
      indicatorsEl.innerHTML = data.map((_, i) =>
        `<button aria-label="Testimonial ${i + 1}" class="${i === 0 ? 'active' : ''}"></button>`
      ).join('');
    }

    window.dispatchEvent(new CustomEvent('testimonialsLoaded'));
  }

  /* ── Team (homepage) ─────────────────────────────────────── */
  async function initTeamSlider() {
    const track = document.querySelector('#team-track');
    if (!track) return;

    const data = await fetchJSON('team.json');
    if (!data.length) return;

    track.innerHTML = data.map(m => `
      <div class="team-card">
        <div class="team-card-photo">
          <img src="${m.photo}" alt="${m.name}" loading="lazy" onerror="this.parentElement.innerHTML='<i class=\\'bx bx-user\\'></i>'">
        </div>
        <div class="team-card-name">${m.name}</div>
        <div class="team-card-position">${LANG === 'en' ? (m.position_en || m.position) : m.position}</div>
        <div class="team-card-socials">
          ${m.social.linkedin ? `<a href="${m.social.linkedin}" class="team-social-link" aria-label="LinkedIn"><i class='bx bxl-linkedin'></i></a>` : ''}
          ${m.social.instagram ? `<a href="${m.social.instagram}" class="team-social-link" aria-label="Instagram"><i class='bx bxl-instagram'></i></a>` : ''}
        </div>
      </div>`).join('');

    const indicatorsEl = document.querySelector('#team-indicators');
    if (indicatorsEl) {
      const visibleItems = window.innerWidth >= 992 ? 4 : window.innerWidth >= 576 ? 2 : 1;
      const pages = Math.ceil(data.length / visibleItems);
      indicatorsEl.innerHTML = Array.from({ length: pages }, (_, i) =>
        `<button aria-label="Page ${i + 1}" class="${i === 0 ? 'active' : ''}"></button>`
      ).join('');
    }

    window.dispatchEvent(new CustomEvent('teamLoaded'));
  }

  /* ── Init on DOMContentLoaded ────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    initFeaturedExperiences();
    initToursPage();
    initAccommodationsPage();
    initPackagePage();
    initTestimonials();
    initTeamSlider();
  });
})();
