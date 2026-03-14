/**
 * components.js
 * Fetches and injects navbar.html and footer.html into the page.
 * Re-initialises Bootstrap dropdowns after injection.
 */
(function () {
  'use strict';

  const BASE = (() => {
    // Resolve the components path relative to the current page location.
    // All pages live in /pages/ — components are at ../components/
    const path = window.location.pathname;
    if (path.includes('/pages/')) return '../components/';
    return './components/';
  })();

  /**
   * Fetch an HTML partial and inject it into a container element.
   * @param {string} url        – path to the HTML partial
   * @param {string} selector   – CSS selector for the target container
   * @param {Function} [cb]     – optional callback after injection
   */
  async function fetchComponent(url, selector, cb) {
    const el = document.querySelector(selector);
    if (!el) return;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      el.innerHTML = await res.text();
      if (typeof cb === 'function') cb(el);
    } catch (err) {
      console.warn(`[components.js] Could not load "${url}":`, err.message);
    }
  }

  /** Mark the active nav link based on the current page filename. */
  function markActiveNavLink(container) {
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const links = container.querySelectorAll('.nav-link-item > a, .mobile-nav-link[data-page]');
    links.forEach(link => {
      const href = link.getAttribute('href') || link.dataset.page || '';
      if (href && href.includes(page)) {
        link.classList.add('active');
      }
    });
  }

  /** Initialise Bootstrap dropdown components dynamically. */
  function initBootstrapDropdowns() {
    if (typeof bootstrap === 'undefined') return;
    document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach(el => {
      new bootstrap.Dropdown(el);
    });
  }

  /** Load all components on DOMContentLoaded. */
  document.addEventListener('DOMContentLoaded', async () => {
    await fetchComponent(BASE + 'navbar.html', '#navbar-placeholder', el => {
      markActiveNavLink(el);
      initMobileNav(el);
      initStickyNavbar();
      initLangSwitch(el);
    });

    await fetchComponent(BASE + 'footer.html', '#footer-placeholder');
  });

  /** Mobile navigation toggle logic. */
  function initMobileNav(container) {
    const toggler = container.querySelector('.navbar-toggler');
    const mobileNav = container.querySelector('.mobile-nav');
    const overlay = container.querySelector('.mobile-nav-overlay');
    const closeBtn = container.querySelector('.mobile-nav-close');

    if (!toggler || !mobileNav) return;

    function openNav() {
      mobileNav.classList.add('open');
      if (overlay) overlay.classList.add('open');
      toggler.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeNav() {
      mobileNav.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      toggler.classList.remove('open');
      document.body.style.overflow = '';
    }

    toggler.addEventListener('click', () => {
      mobileNav.classList.contains('open') ? closeNav() : openNav();
    });

    if (closeBtn) closeBtn.addEventListener('click', closeNav);
    if (overlay) overlay.addEventListener('click', closeNav);

    // Mobile accordion sub-menus
    container.querySelectorAll('.mobile-nav-link[data-toggle]').forEach(link => {
      link.addEventListener('click', () => {
        const target = link.dataset.toggle;
        const sub = container.querySelector(`[data-submenu="${target}"]`);
        if (!sub) return;
        const icon = link.querySelector('i');
        sub.classList.toggle('open');
        if (icon) icon.style.transform = sub.classList.contains('open') ? 'rotate(180deg)' : '';
      });
    });
  }

  /** Add scrolled class to navbar on scroll. */
  function initStickyNavbar() {
    const navbar = document.querySelector('.main-navbar');
    if (!navbar) return;
    const onScroll = () => {
      navbar.classList.toggle('scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /** Language switch buttons. */
  function initLangSwitch(container) {
    container.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Future: dispatch a 'langChange' event with btn.dataset.lang
      });
    });
  }
})();
