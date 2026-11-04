// ─────────────────────────────────────────────────────────────────────────────
// i18n.js — English for the panel, as a layer over the Portuguese views: fixed
// text is swapped as it reaches the screen, so views stay as they are. New text
// in a view must be added to i18n-en.js (scripts/check-admin-i18n.py lists gaps).
// Only known text changes; what people wrote is also fenced off by NOT_TEXT.
// ─────────────────────────────────────────────────────────────────────────────
const KEY = 'mb_admin_lang';
const ATTRS = ['placeholder', 'title', 'aria-label'];
// Words from customers, staff or the catalogue never change, even if they match
const NOT_TEXT = 'textarea, script, style, [data-no-i18n], .chat-msg__body, .chat-item__preview, .chat-item__name, .chat-sys, .chatv__who h2, .quick-use span, .chat-page, .sidebar__user-name';

export function getLang() {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'pt'; } catch { return 'pt'; }
}

export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* private window */ }
  location.reload();
}

let exact = new Map(), patterns = [];

function compile(dict) {
  exact = new Map();
  patterns = [];
  for (const [pt, en] of Object.entries(dict)) {
    if (!pt.includes('{}')) { exact.set(pt, en); continue; }
    const re = new RegExp(`^${pt.split('{}').map(s => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('(.*?)')}$`, 's');
    patterns.push({ re, parts: en.split('{}'), weight: pt.replace(/\{\}/g, '').length });
  }
  patterns.sort((a, b) => b.weight - a.weight);   // the most specific sentence wins
}

function whole(text) {
  const hit = exact.get(text);
  if (hit !== undefined) return hit;
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m) return p.parts.reduce((out, part, i) => out + (i ? (exact.get(m[i]) ?? m[i]) : '') + part, '');
  }
  return null;
}

/** A sentence, or a line built from parts joined by " · ". */
export function translate(text) {
  const out = whole(text);
  if (out !== null || !text.includes(' · ')) return out;
  const parts = text.split(' · ').map(p => whole(p) ?? p);
  return parts.join(' · ') === text ? null : parts.join(' · ');
}

/** Keeps the spaces around the text, which separate it from what comes next. */
function swap(value) {
  const core = value.replace(/\s+/g, ' ').trim();
  if (core.length < 2) return null;
  const out = translate(core);
  if (out === null || out === core) return null;
  return (/^\s/.test(value) ? ' ' : '') + out + (/\s$/.test(value) ? ' ' : '');
}

function textNode(n) {
  const p = n.parentElement;
  if (!p || p.closest(NOT_TEXT)) return;
  const out = swap(n.nodeValue);
  if (out === null) return;
  // An <option> with no value submits its text: keep the original as the value
  if (p.tagName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', n.nodeValue.trim());
  n.nodeValue = out;
}

function element(el) {
  if (el.tagName !== 'TEXTAREA' && el.closest(NOT_TEXT)) return;   // a textarea's hint is ours, its text is not
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const out = swap(v);
    if (out !== null) el.setAttribute(a, out);
  }
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) return textNode(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  element(root);
  for (const el of root.querySelectorAll('[placeholder], [title], [aria-label]')) element(el);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) textNode(n);
}

function translateTitle() {
  const [name, ...rest] = document.title.split(' | ');
  const next = [translate(name) ?? name, ...rest].join(' | ').replace('Painel Maputo Blue', 'Maputo Blue Panel');
  if (next !== document.title) document.title = next;   // writing it fires the observer again
}

/** Dates and numbers formatted in the views, and the browser's own dialogs. */
function patchRuntime() {
  for (const [proto, names] of [[Date.prototype, ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']], [Number.prototype, ['toLocaleString']]]) {
    for (const name of names) {
      const original = proto[name];
      proto[name] = function (locale, options) { return original.call(this, locale === 'pt-PT' ? 'en-GB' : locale, options); };
    }
  }
  for (const name of ['alert', 'confirm', 'prompt']) {
    const original = window[name];
    window[name] = (text, ...rest) => original.call(window, translate(String(text)) ?? text, ...rest);
  }
}

export async function startI18n() {
  const lang = getLang();
  document.documentElement.lang = lang === 'en' ? 'en' : 'pt-MZ';
  for (const button of document.querySelectorAll('[data-lang-toggle]')) {
    button.textContent = lang === 'en' ? 'PT' : 'EN';
    button.title = lang === 'en' ? 'Mudar para português' : 'Switch to English';
    button.setAttribute('aria-label', button.title);
    button.dataset.noI18n = '';
    button.addEventListener('click', () => setLang(lang === 'en' ? 'pt' : 'en'));
  }
  if (lang !== 'en') return;
  compile((await import('./i18n-en.js')).default);
  patchRuntime();
  walk(document.body);
  translateTitle();
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') textNode(m.target);
      else if (m.type === 'attributes') element(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  new MutationObserver(translateTitle).observe(document.querySelector('title'), { childList: true });
}
