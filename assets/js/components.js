/**
 * components.js
 * Fetches and injects navbar.html / navbar-en.html and footer components.
 * Handles path resolution for root, /pages/, and /en/ locations.
 */
(function () {
  'use strict';

  const path = window.location.pathname;

  /* ── Path resolution ─────────────────────────────────────────
     Supported locations:
       /index.html            → root
       /pages/tours.html      → pages/
       /en/index.html         → en/
       /en/tours.html         → en/  (flat structure)
  ─────────────────────────────────────────────────────────────── */
  const IN_EN    = path.includes('/en/');
  const IN_PAGES = path.includes('/pages/') && !IN_EN;
  const BASE     = (IN_EN || IN_PAGES) ? '../components/' : './components/';

  /* Current language from <html lang=""> */
  const LANG = document.documentElement.lang.startsWith('en') ? 'en' : 'pt';

  /**
   * Fetch an HTML partial and inject it into a container element.
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
    const page = path.split('/').pop() || 'index.html';
    const links = container.querySelectorAll('.nav-link-item > a, .mobile-nav-link[data-page]');
    links.forEach(link => {
      const href = link.getAttribute('href') || link.dataset.page || '';
      if (href && href.includes(page)) link.classList.add('active');
    });
  }

  /** Add scrolled class to navbar on scroll. */
  function initStickyNavbar() {
    const navbar = document.querySelector('.main-navbar');
    if (!navbar) return;
    const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /** Mobile navigation toggle logic. */
  function initMobileNav(container) {
    const toggler  = container.querySelector('.navbar-toggler');
    const mobileNav = container.querySelector('.mobile-nav');
    const overlay  = container.querySelector('.mobile-nav-overlay');
    const closeBtn = container.querySelector('.mobile-nav-close');

    if (!toggler || !mobileNav) return;

    const openNav  = () => { mobileNav.classList.add('open'); overlay?.classList.add('open'); toggler.classList.add('open'); document.body.style.overflow = 'hidden'; };
    const closeNav = () => { mobileNav.classList.remove('open'); overlay?.classList.remove('open'); toggler.classList.remove('open'); document.body.style.overflow = ''; };

    toggler.addEventListener('click', () => mobileNav.classList.contains('open') ? closeNav() : openNav());
    closeBtn?.addEventListener('click', closeNav);
    overlay?.addEventListener('click', closeNav);

    container.querySelectorAll('.mobile-nav-link[data-toggle]').forEach(link => {
      link.addEventListener('click', () => {
        const sub  = container.querySelector(`[data-submenu="${link.dataset.toggle}"]`);
        if (!sub) return;
        const icon = link.querySelector('i');
        sub.classList.toggle('open');
        if (icon) icon.style.transform = sub.classList.contains('open') ? 'rotate(180deg)' : '';
      });
    });
  }

  /**
   * Language switch — redirects to the equivalent page in the other language.
   *
   * Directory map:
   *   PT root:       /index.html          ↔  EN: /en/index.html
   *   PT pages/:     /pages/tours.html    ↔  EN: /en/tours.html
   *   PT pages/:     /pages/package.html  ↔  EN: /en/package.html
   *
   * Relative paths are used so the site works under any base URL.
   */
  function initLangSwitch(container) {
    const qs = window.location.search;

    function getEquivalentUrl(targetLang) {
      if (targetLang === LANG) return null; // already on this language

      if (LANG === 'pt') {
        // PT → EN
        if (IN_PAGES) {
          // /pages/tours.html → ../en/tours.html
          const file = path.split('/pages/')[1];
          return '../en/' + file + qs;
        }
        // /index.html → en/index.html
        return 'en/index.html';
      } else {
        // EN → PT
        const file = path.split('/en/')[1] || 'index.html';
        if (file === 'index.html' || file === '') {
          return '../index.html';
        }
        // /en/tours.html → ../pages/tours.html
        return '../pages/' + file + qs;
      }
    }

    // Set active state
    container.querySelectorAll('.lang-btn').forEach(btn => {
      const isActive = btn.dataset.lang === LANG;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');

      btn.addEventListener('click', () => {
        const url = getEquivalentUrl(btn.dataset.lang);
        if (url) window.location.href = url;
      });
    });
  }

  /** Load all components on DOMContentLoaded. */
  document.addEventListener('DOMContentLoaded', async () => {
    const navbarFile = LANG === 'en' ? 'navbar-en.html' : 'navbar.html';
    const footerFile = LANG === 'en' ? 'footer-en.html' : 'footer.html';

    await fetchComponent(BASE + navbarFile, '#navbar-placeholder', el => {
      markActiveNavLink(el);
      initMobileNav(el);
      initStickyNavbar();
      initLangSwitch(el);
    });

    await fetchComponent(BASE + footerFile, '#footer-placeholder');
  });
})();
