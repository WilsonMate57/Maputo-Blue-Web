/**
 * slider.js
 * Custom multi-item and single-item sliders with touch/swipe support.
 * Safe – guards all DOM selectors.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     MultiItemSlider
     Supports: responsive visible-items, arrows, indicators,
               auto-advance, touch/swipe.
  ══════════════════════════════════════════════════════════ */
  class MultiItemSlider {
    /**
     * @param {string} trackSel       – CSS selector for the flex track
     * @param {string} prevSel        – CSS selector for the prev arrow
     * @param {string} nextSel        – CSS selector for the next arrow
     * @param {string|null} indSel    – CSS selector for indicators container
     * @param {object} opts
     *   @param {object} opts.visible – { lg: 4, md: 2, sm: 1 }
     *   @param {number} opts.gap     – gap in px between items (matches CSS gap)
     */
    constructor(trackSel, prevSel, nextSel, indSel = null, opts = {}) {
      this.track = document.querySelector(trackSel);
      this.prev  = document.querySelector(prevSel);
      this.next  = document.querySelector(nextSel);
      this.indContainer = indSel ? document.querySelector(indSel) : null;
      this.opts  = Object.assign({ visible: { lg: 4, md: 2, sm: 1 }, gap: 24 }, opts);

      if (!this.track) return;

      this.currentPage = 0;
      this._bindEvents();
      this._update();

      window.addEventListener('resize', this._debounce(() => this._update(), 180));
    }

    get items()        { return Array.from(this.track.children); }
    get visibleCount() {
      const w = window.innerWidth;
      if (w >= 992) return this.opts.visible.lg || 4;
      if (w >= 576) return this.opts.visible.md || 2;
      return this.opts.visible.sm || 1;
    }
    get pageCount()    { return Math.max(1, Math.ceil(this.items.length / this.visibleCount)); }

    _update() {
      const vc   = this.visibleCount;
      const gap  = this.opts.gap;
      const pct  = 100 / vc;

      this.items.forEach(item => {
        item.style.flex = `0 0 calc(${pct}% - ${gap * (vc - 1) / vc}px)`;
      });

      // Clamp page
      this.currentPage = Math.min(this.currentPage, this.pageCount - 1);
      this._move();
      this._updateIndicators();
      this._updateArrows();
    }

    _move() {
      const vc   = this.visibleCount;
      const gap  = this.opts.gap;
      const pct  = 100 / vc;
      const offset = this.currentPage * vc * (pct + gap / this.track.offsetWidth * 100);
      // Simpler: translate by item width × items-per-page × page
      const itemW = this.track.offsetWidth / vc;
      this.track.style.transform = `translateX(-${this.currentPage * vc * (itemW + gap)}px)`;
    }

    goTo(page) {
      this.currentPage = Math.max(0, Math.min(page, this.pageCount - 1));
      this._move();
      this._updateIndicators();
      this._updateArrows();
    }

    _bindEvents() {
      if (this.prev) this.prev.addEventListener('click', () => this.goTo(this.currentPage - 1));
      if (this.next) this.next.addEventListener('click', () => this.goTo(this.currentPage + 1));
      this._addSwipe(this.track.parentElement || this.track);
    }

    _updateArrows() {
      if (this.prev) this.prev.disabled = this.currentPage === 0;
      if (this.next) this.next.disabled = this.currentPage >= this.pageCount - 1;
    }

    _updateIndicators() {
      if (!this.indContainer) return;
      const btns = this.indContainer.querySelectorAll('button');
      btns.forEach((btn, i) => btn.classList.toggle('active', i === this.currentPage));
    }

    _addSwipe(el) {
      if (!el) return;
      let startX = 0, startY = 0, isDragging = false;

      el.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isDragging = true;
      }, { passive: true });

      el.addEventListener('touchmove', e => {
        if (!isDragging) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (Math.abs(dy) > Math.abs(dx)) { isDragging = false; return; }
        e.preventDefault();
      }, { passive: false });

      el.addEventListener('touchend', e => {
        if (!isDragging) return;
        isDragging = false;
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 40) {
          dx < 0 ? this.goTo(this.currentPage + 1) : this.goTo(this.currentPage - 1);
        }
      });
    }

    _debounce(fn, delay) {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
    }
  }

  /* ══════════════════════════════════════════════════════════
     SingleSlider  (testimonials, single hero-like)
  ══════════════════════════════════════════════════════════ */
  class SingleSlider {
    /**
     * @param {string} trackSel     – the flex track
     * @param {string} prevSel
     * @param {string} nextSel
     * @param {string|null} indSel  – indicators container
     * @param {object} opts
     *   @param {boolean} opts.autoplay
     *   @param {number}  opts.delay   (ms)
     */
    constructor(trackSel, prevSel, nextSel, indSel = null, opts = {}) {
      this.track     = document.querySelector(trackSel);
      this.prevBtn   = document.querySelector(prevSel);
      this.nextBtn   = document.querySelector(nextSel);
      this.indCont   = indSel ? document.querySelector(indSel) : null;
      this.opts      = Object.assign({ autoplay: false, delay: 5000 }, opts);
      this.current   = 0;
      this._timer    = null;

      if (!this.track) return;

      this._bindEvents();
      this._updateIndicators();
      this._updateArrows();

      if (this.opts.autoplay) this._startAuto();
    }

    get items()  { return Array.from(this.track.children); }
    get total()  { return this.items.length; }

    goTo(idx) {
      this.current = (idx + this.total) % this.total;
      this.track.style.transform = `translateX(-${this.current * 100}%)`;
      this._updateIndicators();
      this._updateArrows();
    }

    next() { this.goTo(this.current + 1); }
    prev() { this.goTo(this.current - 1); }

    _startAuto() {
      this._timer = setInterval(() => this.next(), this.opts.delay);
      this.track.parentElement?.addEventListener('mouseenter', () => clearInterval(this._timer));
      this.track.parentElement?.addEventListener('mouseleave', () => {
        this._timer = setInterval(() => this.next(), this.opts.delay);
      });
    }

    _bindEvents() {
      if (this.prevBtn) this.prevBtn.addEventListener('click', () => { clearInterval(this._timer); this.prev(); });
      if (this.nextBtn) this.nextBtn.addEventListener('click', () => { clearInterval(this._timer); this.next(); });

      if (this.indCont) {
        this.indCont.addEventListener('click', e => {
          const btn = e.target.closest('button');
          if (!btn) return;
          const idx = Array.from(this.indCont.children).indexOf(btn);
          if (idx >= 0) { clearInterval(this._timer); this.goTo(idx); }
        });
      }

      this._addSwipe(this.track.parentElement || this.track);
    }

    _updateIndicators() {
      if (!this.indCont) return;
      this.indCont.querySelectorAll('button').forEach((btn, i) =>
        btn.classList.toggle('active', i === this.current)
      );
    }

    _updateArrows() {
      // Circular — always enabled
    }

    _addSwipe(el) {
      if (!el) return;
      let startX = 0, isDrag = false;

      el.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX; isDrag = true;
      }, { passive: true });

      el.addEventListener('touchend', e => {
        if (!isDrag) return; isDrag = false;
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 40) {
          clearInterval(this._timer);
          dx < 0 ? this.next() : this.prev();
        }
      });
    }
  }

  /* ══════════════════════════════════════════════════════════
     Initialisation — wires up all sliders after DOM+data ready
  ══════════════════════════════════════════════════════════ */
  function initTeamSliderComponent() {
    const track = document.querySelector('#team-track');
    if (!track || !track.children.length) return;

    window._teamSlider = new MultiItemSlider(
      '#team-track',
      '#team-prev',
      '#team-next',
      '#team-indicators',
      { visible: { lg: 4, md: 2, sm: 1 }, gap: 24 }
    );
  }

  function initTestimonialsSliderComponent() {
    const track = document.querySelector('#testimonials-track');
    if (!track || !track.children.length) return;

    window._testimonialSlider = new SingleSlider(
      '#testimonials-track',
      '#testimonials-prev',
      '#testimonials-next',
      '#testimonials-indicators',
      { autoplay: true, delay: 6000 }
    );
  }

  // Listen for data-loader signals
  window.addEventListener('teamLoaded', () => {
    setTimeout(initTeamSliderComponent, 50);
  });

  window.addEventListener('testimonialsLoaded', () => {
    setTimeout(initTestimonialsSliderComponent, 50);
  });

  // Also try on DOMContentLoaded in case data was already injected
  document.addEventListener('DOMContentLoaded', () => {
    // Small delay to let data-loader inject content first
    setTimeout(() => {
      initTeamSliderComponent();
      initTestimonialsSliderComponent();
    }, 300);
  });

  // Gallery slider on package page
  document.addEventListener('DOMContentLoaded', () => {
    const gallerySlider = document.querySelector('.gallery-main-image');
    if (!gallerySlider) return;
    // Gallery is handled directly in data-loader.js via click events
  });
})();
