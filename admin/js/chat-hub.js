// ─────────────────────────────────────────────────────────────────────────────
// chat-hub.js — Live chat outside the Live Chat page: the connection to the
// server, the person's presence, notifications anywhere in the panel. Views
// subscribe with onChat(); with no event stream the hub falls back to polling.
// ─────────────────────────────────────────────────────────────────────────────
import { esc, post } from './core.js';

const HEARTBEAT_MS = 30_000, READY_MS = 6000, POLL_MS = 5000;
const SOUND_KEY = 'mb_chat_sound';

const listeners = new Set();
let es = null, beat = null, poll = null, readyTimer = null, onBadges = () => {}, active = false, wasReady = false;
let viewing = null;       // conversation on screen
let presenceEl = null;

export function onChat(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setViewing(id) { viewing = id; }

export function soundOn() { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } }
export function setSound(on) { try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* private window */ } }

let audio = null;
function chime() {
  if (!soundOn()) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    [[660, 0], [880, .12]].forEach(([freq, at]) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + at;
      o.frequency.value = freq;
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(.07, t + .02);
      g.gain.exponentialRampToValueAtTime(.0001, t + .22);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + .24);
    });
  } catch { /* no audio available */ }
}

/** A discreet card that opens the conversation. */
function notify(text, sub, id) {
  const box = document.getElementById('toasts');
  const a = document.createElement('a');
  a.className = 'toast chat-toast';
  a.href = `#/chat/${id}`;
  a.setAttribute('role', 'status');
  a.innerHTML = `<i class='bx bx-message-rounded-dots'></i><span><b>${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
  a.addEventListener('click', () => a.remove());
  box.appendChild(a);
  setTimeout(() => a.remove(), 9000);
}

function dispatch(evt) {
  for (const fn of listeners) fn(evt);
  if (['new', 'message', 'read', 'state'].includes(evt.t)) onBadges();
  const here = document.visibilityState === 'visible' && viewing === evt.c;
  if (evt.t === 'new') { notify('Nova conversa no Live Chat', '', evt.c); chime(); }
  if (evt.t === 'message' && evt.kind === 'visitor' && !here) {
    notify(evt.returned ? 'O visitante voltou à conversa' : 'Nova mensagem no Live Chat', evt.message ? evt.message.body.slice(0, 90) : '', evt.c);
    chime();
  }
}

function startPolling() {
  if (es) { es.close(); es = null; }
  clearTimeout(readyTimer);
  clearInterval(poll);
  poll = setInterval(() => { if (document.visibilityState === 'visible') dispatch({ t: 'resync' }); }, POLL_MS);
}

function connect() {
  es = new EventSource('/api/admin/chat/stream');
  readyTimer = setTimeout(startPolling, READY_MS);
  es.addEventListener('ready', () => {
    clearTimeout(readyTimer);
    if (wasReady) dispatch({ t: 'resync' });    // reconnected: fetch what passed meanwhile
    wasReady = true;
  });
  es.addEventListener('chat', e => dispatch(JSON.parse(e.data)));
  es.onerror = () => { if (es && es.readyState === EventSource.CLOSED && active) startPolling(); };
}

function showPresence(status, withinHours) {
  if (!presenceEl) return;
  presenceEl.querySelector('select').value = status;
  presenceEl.dataset.status = status;
  presenceEl.title = withinHours === false ? 'Fora do horário de atendimento: os visitantes vêem a equipa como offline.' : '';
}

async function presence(status) {
  try {
    const r = await post('/admin/chat/presence', status ? { status } : {});
    showPresence(r.status, r.within_hours);
  } catch { /* the next beat tries again */ }
}

export function startHub({ refreshBadges, element }) {
  if (active) return;
  active = true;
  onBadges = refreshBadges;
  presenceEl = element;
  presenceEl.querySelector('select').onchange = e => presence(e.target.value);
  presence();
  beat = setInterval(() => presence(), HEARTBEAT_MS);
  if (window.EventSource) connect(); else startPolling();
}

export function stopHub() {
  active = false;
  wasReady = false;
  clearInterval(beat);
  clearInterval(poll);
  clearTimeout(readyTimer);
  if (es) { es.close(); es = null; }
}
