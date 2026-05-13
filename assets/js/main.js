/**
 * main.js
 * Global page initialisation — FAQ accordion, scroll-to-top,
 * smooth scroll, lazy image fallback, misc UI enhancements.
 *
 * @copyright  2026 Maputo Blue. All rights reserved.
 * @author     Wilson Creative Studio
 * @license    Proprietary — Unauthorised use or distribution is prohibited.
 */
(function () {
  'use strict';

  /* ── FAQ Accordion ──────────────────────────────────────── */
  function initFAQ() {
    const accordion = document.querySelector('.faq-accordion');
    if (!accordion) return;

    accordion.querySelectorAll('.faq-question').forEach(question => {
      question.addEventListener('click', () => {
        const item = question.closest('.faq-item');
        if (!item) return;

        const isOpen = item.classList.contains('open');

        // Close all
        accordion.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));

        // Open clicked (toggle)
        if (!isOpen) item.classList.add('open');
      });
    });
  }

  /* ── Scroll-to-top Button ───────────────────────────────── */
  function initScrollToTop() {
    const btn = document.querySelector('.scroll-to-top');
    if (!btn) return;

    window.addEventListener('scroll', () => {
      btn.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── Intersection Observer — fade-in on scroll ──────────── */
  function initScrollReveal() {
    const elements = document.querySelectorAll(
      '.tour-card, .accommodation-card, .destination-card, .team-card, .why-advantage-item'
    );
    if (!elements.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    elements.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = `opacity 0.45s ease ${i * 0.06}s, transform 0.45s ease ${i * 0.06}s`;
      observer.observe(el);
    });
  }

  /* ── Image lazy-load fallback ───────────────────────────── */
  function initImageFallbacks() {
    document.querySelectorAll('img[loading="lazy"]').forEach(img => {
      img.addEventListener('error', function () {
        this.style.display = 'none';
      });
    });
  }

  /* ── Smooth scroll for anchor links ────────────────────── */
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', e => {
        const target = document.querySelector(link.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        const offset = 88; // sticky navbar height
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      });
    });
  }

  /* ── Counter Animation (for stats if present) ──────────── */
  function initCounters() {
    const counters = document.querySelectorAll('[data-count]');
    if (!counters.length) return;

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el     = entry.target;
        const target = parseInt(el.dataset.count, 10);
        const suffix = el.dataset.suffix || '';
        let current  = 0;
        const step   = Math.ceil(target / 60);
        const timer  = setInterval(() => {
          current = Math.min(current + step, target);
          el.textContent = current.toLocaleString('pt-MZ') + suffix;
          if (current >= target) clearInterval(timer);
        }, 20);
        observer.unobserve(el);
      });
    }, { threshold: 0.5 });

    counters.forEach(el => observer.observe(el));
  }

  /* ── Booking button ripple ──────────────────────────────── */
  function initRipple() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.btn-primary-mb, .tour-card-btn, .hero-btn-primary');
      if (!btn) return;
      const ripple = document.createElement('span');
      ripple.style.cssText = `
        position:absolute;border-radius:50%;
        width:80px;height:80px;
        background:rgba(255,255,255,.25);
        transform:scale(0);
        animation:rippleAnim .5s linear;
        pointer-events:none;
        left:${e.clientX - btn.getBoundingClientRect().left - 40}px;
        top:${e.clientY - btn.getBoundingClientRect().top - 40}px;
      `;
      if (!ripple.style.position) return; // guard
      if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
      btn.style.overflow = 'hidden';
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 520);
    });

    const style = document.createElement('style');
    style.textContent = '@keyframes rippleAnim{to{transform:scale(3);opacity:0;}}';
    document.head.appendChild(style);
  }

  /* ── WhatsApp button phone number ───────────────────────── */
  function initWhatsApp() {
    const btn = document.querySelector('.whatsapp-btn');
    if (!btn) return;
    if (!btn.getAttribute('href') || btn.getAttribute('href') === '#') {
      btn.setAttribute('href', 'https://wa.me/258847121666?text=Olá%2C%20gostaria%20de%20saber%20mais%20sobre%20os%20vossos%20tours.');
      btn.setAttribute('target', '_blank');
      btn.setAttribute('rel', 'noopener noreferrer');
    }
  }

  /* ── Bootstrap Hero Carousel reset on slide ────────────── */
  function initHeroCarousel() {
    const carousel = document.querySelector('#heroCarousel');
    if (!carousel) return;
    carousel.addEventListener('slide.bs.carousel', e => {
      // Reset animations so they replay on next slide
      const items = carousel.querySelectorAll('.hero-eyebrow, .hero-title, .hero-description, .hero-actions');
      items.forEach(el => {
        el.style.animation = 'none';
        el.getBoundingClientRect(); // reflow
        el.style.animation = '';
      });
    });
  }

  /* ── Active nav link via current page ──────────────────── */
  function initActiveNavFromURL() {
    const page = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-link-item > a').forEach(link => {
      const href = (link.getAttribute('href') || '').split('/').pop();
      if (href && href === page) link.classList.add('active');
    });
  }

  /* ── DOMContentLoaded ───────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    initFAQ();
    initScrollToTop();
    initScrollReveal();
    initImageFallbacks();
    initSmoothScroll();
    initCounters();
    initRipple();
    initWhatsApp();
    initHeroCarousel();
    initActiveNavFromURL();
  });
})();
