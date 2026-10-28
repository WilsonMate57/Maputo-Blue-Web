/**
 * analytics.js
 * First-party visit statistics (shown in the admin → Estatísticas): page view,
 * time with the page visible, scroll depth and click positions for heatmaps.
 * No cookies, no third parties; nothing typed in forms is ever read. Respects
 * "Do Not Track" / Global Privacy Control. Loaded by main.js.
 *
 * @copyright  2026 Maputo Blue. All rights reserved.
 * @author     Wilson Creative Studio
 * @license    Proprietary — Unauthorised use or distribution is prohibited.
 */
(function () {
  'use strict';

  if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl) return;
  if (window.top !== window.self || /[?&]mb_noanalytics=1/.test(location.search)) return; // admin heatmap preview
  if (/^\/admin\b/.test(location.pathname)) return;

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

  // Session: random id for this tab only (cleared when the tab closes)
  let sid;
  try {
    sid = sessionStorage.getItem('mb_sid');
    if (!sid) { sid = uuid(); sessionStorage.setItem('mb_sid', sid); }
  } catch { sid = uuid(); }
  const id = uuid();

  const params = new URLSearchParams(location.search);
  const pkg = /\/package\.html$/.test(location.pathname) && params.get('id');
  const path = location.pathname + (pkg && /^[a-z0-9-]{1,80}$/.test(pkg) ? `?id=${pkg}` : '');

  function send(data, beacon) {
    const body = JSON.stringify(Object.assign({ id, sid }, data));
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon('/api/t', new Blob([body], { type: 'application/json' }))) return;
      fetch('/api/t', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' })
        .catch(() => {});
    } catch { /* statistics never break the page */ }
  }

  const utm = k => (params.get(k) || '').slice(0, 80) || undefined;
  send({
    t: 'pv', path, title: document.title.slice(0, 150), ref: document.referrer.slice(0, 500),
    lang: document.documentElement.lang || undefined, vw: Math.round(window.innerWidth),
    utm_source: utm('utm_source'), utm_medium: utm('utm_medium'), utm_campaign: utm('utm_campaign'),
  });

  // Time with the page visible, and the deepest point reached
  let visibleMs = 0, since = document.visibilityState === 'visible' ? Date.now() : null, depth = 0;
  const docHeight = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  function trackScroll() {
    const h = docHeight();
    if (h) depth = Math.max(depth, Math.min(100, Math.round(((window.scrollY + window.innerHeight) / h) * 100)));
  }
  window.addEventListener('scroll', trackScroll, { passive: true });
  window.addEventListener('load', trackScroll);
  function leave() {
    if (since) { visibleMs += Date.now() - since; since = null; }
    trackScroll();
    send({ t: 'leave', ms: Math.round(visibleMs), sp: depth }, true);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
    else since = Date.now();
  });
  window.addEventListener('pagehide', leave);

  // Clicks: position on the page + the text of the button or link (never form values)
  const CLICKABLE = 'a, button, [role="button"], summary, input[type="submit"], input[type="button"], .mb-cal__day, .chip';
  let clicks = 0;
  document.addEventListener('click', e => {
    if (++clicks > 300) return;
    const width = document.documentElement.scrollWidth || window.innerWidth;
    const el = e.target instanceof Element ? e.target.closest(CLICKABLE) : null;
    let label, href;
    if (el) {
      label = (el.getAttribute('aria-label') || (el.matches('input') ? el.value : el.textContent) || el.getAttribute('title') || '')
        .replace(/\s+/g, ' ').trim().slice(0, 80) || undefined;
      const a = el.closest('a[href]');
      if (a) {
        try {
          const u = new URL(a.href, location.href);
          href = (u.origin === location.origin ? u.pathname : `${u.protocol}//${u.host}${u.pathname}`).slice(0, 200);
        } catch { href = undefined; }
      }
    }
    send({
      t: 'click', x: Math.min(1, Math.max(0, e.pageX / width)), y: Math.max(0, Math.round(e.pageY)),
      label, tag: el ? el.tagName.toLowerCase() : undefined, href,
    });
  }, { capture: true, passive: true });
})();
