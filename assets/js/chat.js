/**
 * chat.js
 * Live chat widget on every public page. Loaded by main.js. Talks to /api/chat:
 * messages arrive over an event stream, with polling when the stream is not
 * available. Text from people is only ever placed with textContent.
 *
 * @copyright  2026 Maputo Blue. All rights reserved.
 * @author     Wilson Creative Studio
 * @license    Proprietary — Unauthorised use or distribution is prohibited.
 */
(function () {
  'use strict';

  if (window.top !== window.self || /^\/admin\b/.test(location.pathname) || location.protocol === 'file:') return;
  if (/[?&]mb_noanalytics=1/.test(location.search)) return;   // admin heatmap preview

  const LANG = document.documentElement.lang.startsWith('en') ? 'en' : 'pt';
  const POLL_MS = 4000, READY_MS = 6000, TYPING_EVERY = 3000, TYPING_SHOWN = 4000;
  const T = {
    pt: {
      open: 'Abrir conversa com a equipa', minimise: 'Minimizar conversa', title: 'Conversa com a Maputo Blue',
      online: 'Equipa online', away: 'Respondemos em breve', offline: 'Equipa offline',
      intro: 'Fale connosco. Respondemos aqui mesmo, sem sair da página.',
      name: 'Nome', email: 'E-mail', phone: 'Telefone', optional: '(opcional)', subject: 'Assunto', choose: 'Escolha um assunto', message: 'Mensagem',
      subjects: { bookings: 'Reservas e disponibilidade', packages: 'Pacotes turísticos', tours: 'Excursões e actividades', transfers: 'Transfers', accommodation: 'Alojamento', general: 'Informações gerais', other: 'Outros assuntos' },
      legal: 'A conversa é guardada para fins de atendimento. Saiba mais na', policy: 'política de privacidade', policyUrl: '/pages/privacy.html',
      start: 'Iniciar conversa', starting: 'A iniciar…', write: 'Escreva a sua mensagem…', send: 'Enviar', you: 'Você', team: 'Maputo Blue',
      sending: 'A enviar', sent: 'Enviada', read: 'Vista', failed: 'Não enviada.', retry: 'Tentar de novo', typing: 'está a escrever', someone: 'A equipa',
      ended: 'Esta conversa foi encerrada.', again: 'Iniciar nova conversa', offlineLine: 'Respondemos assim que possível, também por e-mail.', loading: 'A carregar a conversa…',
      required: 'Preencha o nome, um e-mail válido, o assunto e a mensagem.', network: 'Sem ligação. Verifique a internet e tente de novo.', limited: 'Demasiadas mensagens. Aguarde um momento.', links: 'A mensagem tem demasiadas ligações.', generic: 'Não foi possível enviar. Tente de novo.', closedNow: 'Esta conversa já foi encerrada.',
    },
    en: {
      open: 'Open a conversation with the team', minimise: 'Minimise conversation', title: 'Chat with Maputo Blue',
      online: 'Team online', away: 'We will reply soon', offline: 'Team offline',
      intro: 'Talk to us. We reply right here, without leaving the page.',
      name: 'Name', email: 'E-mail', phone: 'Phone', optional: '(optional)', subject: 'Subject', choose: 'Choose a subject', message: 'Message',
      subjects: { bookings: 'Bookings and availability', packages: 'Tour packages', tours: 'Excursions and activities', transfers: 'Transfers', accommodation: 'Accommodation', general: 'General information', other: 'Other matters' },
      legal: 'This conversation is stored for customer service. Read more in the', policy: 'privacy policy', policyUrl: '/en/privacy.html',
      start: 'Start conversation', starting: 'Starting…', write: 'Write your message…', send: 'Send', you: 'You', team: 'Maputo Blue',
      sending: 'Sending', sent: 'Sent', read: 'Seen', failed: 'Not sent.', retry: 'Try again', typing: 'is typing', someone: 'The team',
      ended: 'This conversation has ended.', again: 'Start a new conversation', offlineLine: 'We will reply as soon as possible, also by e-mail.', loading: 'Loading the conversation…',
      required: 'Please fill in your name, a valid e-mail, the subject and the message.', network: 'No connection. Check your internet and try again.', limited: 'Too many messages. Please wait a moment.', links: 'The message has too many links.', generic: 'Could not send. Please try again.', closedNow: 'This conversation has already ended.',
    },
  }[LANG];

  const ICON = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.6-5.4A8.4 8.4 0 1 1 21 11.5Z"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4 10-11"/></svg>',
    ticks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 13 4 4 9-10M10 16l1 1 10-11"/></svg>',
    waves: '<svg class="mbc-waves" viewBox="0 0 376 44" preserveAspectRatio="none" fill="none" stroke="#fff" aria-hidden="true"><path d="M0 14 Q47 2 94 14 T188 14 T282 14 T376 14" stroke-width="1.4"/><path d="M0 28 Q47 16 94 28 T188 28 T282 28 T376 28" stroke-width="1.1"/><path d="M0 41 Q47 30 94 41 T188 41 T282 41 T376 41" stroke-width=".8"/></svg>',
  };

  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private window */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* private window */ } },
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const time = d => new Date(d).toLocaleTimeString(LANG === 'en' ? 'en-GB' : 'pt-PT', { hour: '2-digit', minute: '2-digit' });

  /** The address of this page, in the form the server accepts. */
  function pagePath() {
    const id = /\/package\.html$/.test(location.pathname) && new URLSearchParams(location.search).get('id');
    return location.pathname + (id && /^[a-z0-9-]{1,80}$/.test(id) ? `?id=${id}` : '');
  }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    } catch { throw Object.assign(new Error('network'), { code: 'network' }); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error('api'), { code: (data && data.error) || 'internal', status: res.status });
    return data;
  }
  const errorText = e => ({ network: T.network, rate_limited: T.limited, chat_spam: T.links, chat_closed: T.closedNow }[e.code] || T.generic);

  /* ── State ──────────────────────────────────────────────────────────────── */
  let avail = null, conv = null, messages = [], prefill = null;
  let open = false, unread = 0, lastTyping = 0, typingTimer = null;
  let es = null, readyTimer = null, pollTimer = null, polling = false;
  let root, launcher, panel, body, statusEl, statusDot, launcherDot, countEl;

  const lastId = () => messages.reduce((n, m) => (m.id && m.id > n ? m.id : n), 0);
  const isOpenChat = () => conv && conv.status !== 'closed';

  /* ── Shell ──────────────────────────────────────────────────────────────── */
  function build() {
    root = el('div', 'mbc');
    root.innerHTML = `
      <button type="button" class="mbc-launcher" aria-label="${T.open}" aria-expanded="false">${ICON.chat}<span class="mbc-dot"></span><span class="mbc-count" hidden></span></button>
      <section class="mbc-panel" role="dialog" aria-label="${T.title}" hidden>
        <header class="mbc-head">${ICON.waves}
          <img class="mbc-head__logo" src="/logo.webp" alt="" width="38" height="38">
          <div class="mbc-head__text"><span class="mbc-head__title">Maputo <b>Blue</b></span>
            <span class="mbc-head__status"><span class="mbc-dot"></span><span data-status></span></span></div>
          <button type="button" class="mbc-icon-btn" data-min aria-label="${T.minimise}" title="${T.minimise}">${ICON.down}</button>
        </header>
        <div data-body style="display:contents"></div>
      </section>`;
    document.body.appendChild(root);
    document.body.classList.add('has-chat');
    launcher = root.querySelector('.mbc-launcher');
    panel = root.querySelector('.mbc-panel');
    body = root.querySelector('[data-body]');
    statusEl = root.querySelector('[data-status]');
    statusDot = root.querySelector('.mbc-head__status .mbc-dot');
    launcherDot = launcher.querySelector('.mbc-dot');
    countEl = launcher.querySelector('.mbc-count');
    launcher.addEventListener('click', () => setOpen(!open));
    root.querySelector('[data-min]').addEventListener('click', () => setOpen(false));
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
    if (window.visualViewport) {
      const fit = () => panel.style.setProperty('--mbc-vh', `${window.visualViewport.height}px`);
      window.visualViewport.addEventListener('resize', fit);
      fit();
    }
  }

  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    launcher.setAttribute('aria-expanded', String(v));
    launcher.hidden = v && window.matchMedia('(max-width: 575px)').matches;
    document.body.classList.toggle('mbc-locked', v);
    if (v) store.set('mb_chat_open', '1'); else store.del('mb_chat_open');
    if (v) {
      render();
      markRead();
      const target = panel.querySelector('.mbc-composer textarea, .mbc-form input:not(.mbc-trap input)');
      if (target && window.matchMedia('(min-width: 576px)').matches) target.focus();
    } else launcher.focus({ preventScroll: true });
  }

  function showAvailability() {
    const s = avail ? avail.status : 'offline';
    for (const dot of [statusDot, launcherDot]) dot.className = `mbc-dot mbc-dot--${s}`;
    statusEl.textContent = T[s];
    launcher.title = T[s];
  }

  function setUnread(n) {
    unread = n;
    countEl.hidden = !n;
    countEl.textContent = n > 9 ? '9+' : n;
  }

  /* ── Views ──────────────────────────────────────────────────────────────── */
  function render() {
    if (!open) return;
    if (conv) renderConversation(); else renderForm();
  }

  function offlineBanner() {
    if (!avail || avail.status !== 'offline' || !avail.offline_message) return null;
    return el('p', 'mbc-notice', avail.offline_message);
  }

  function renderForm() {
    const keep = { name: store.get('mb_chat_name') || (prefill && prefill.name) || '', email: store.get('mb_chat_email') || (prefill && prefill.email) || '', phone: store.get('mb_chat_phone') || (prefill && prefill.phone) || '' };
    body.replaceChildren();
    const banner = offlineBanner();
    if (banner) body.appendChild(banner);
    const form = el('form', 'mbc-form');
    form.noValidate = true;
    form.innerHTML = `
      <p class="mbc-form__intro">${T.intro}</p>
      <label class="mbc-field">${T.name}<input name="name" autocomplete="name" maxlength="120" required></label>
      <label class="mbc-field">${T.email}<input name="email" type="email" autocomplete="email" inputmode="email" maxlength="200" required></label>
      <label class="mbc-field"><span>${T.phone} <small>${T.optional}</small></span><input name="phone" type="tel" autocomplete="tel" maxlength="30"></label>
      <label class="mbc-field">${T.subject}<select name="subject" required><option value="">${T.choose}</option>${Object.entries(T.subjects).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="mbc-field">${T.message}<textarea name="body" rows="3" maxlength="2000" required></textarea></label>
      <div class="mbc-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <p class="mbc-error" role="alert" hidden></p>
      <button type="submit" class="mbc-btn">${T.start}</button>
      <p class="mbc-legal">${T.legal} <a href="${T.policyUrl}" target="_blank" rel="noopener">${T.policy}</a>.</p>`;
    form.elements.name.value = keep.name;
    form.elements.email.value = keep.email;
    form.elements.phone.value = keep.phone;
    form.addEventListener('submit', submitForm);
    body.appendChild(form);
  }

  async function submitForm(e) {
    e.preventDefault();
    const f = e.currentTarget, err = f.querySelector('.mbc-error'), btn = f.querySelector('button[type=submit]');
    const v = { name: f.elements.name.value.trim(), email: f.elements.email.value.trim(), phone: f.elements.phone.value.trim(), subject: f.elements.subject.value, body: f.elements.body.value.trim() };
    const invalid = { name: v.name.length < 2, email: !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email), subject: !v.subject, body: !v.body, phone: !!v.phone && !/^[+0-9 ()-]{6,30}$/.test(v.phone) };
    for (const k of Object.keys(invalid)) f.elements[k].setAttribute('aria-invalid', String(invalid[k]));
    if (Object.values(invalid).some(Boolean)) {
      err.textContent = T.required;
      err.hidden = false;
      f.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = T.starting;
    try {
      const r = await api('POST', '/chat/start', { name: v.name, email: v.email, ...(v.phone ? { phone: v.phone } : {}), subject: v.subject, body: v.body,
        locale: LANG, path: pagePath(), title: document.title.slice(0, 150), client_id: uuid(), website: f.elements.website.value });
      store.set('mb_chat_name', v.name);
      store.set('mb_chat_email', v.email);
      store.set('mb_chat_phone', v.phone);
      conv = r.conversation;
      messages = r.messages;
      render();
      connect();
      const t = panel.querySelector('.mbc-composer textarea');
      if (t) t.focus();
    } catch (ex) {
      err.textContent = errorText(ex);
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = T.start;
    }
  }

  function renderConversation() {
    if (!panel.querySelector('.mbc-log')) {
      body.replaceChildren();
      const line = el('p', 'mbc-offline-line');
      line.hidden = true;
      const log = el('div', 'mbc-log');
      log.setAttribute('role', 'log');
      log.setAttribute('aria-live', 'polite');
      const typing = el('div', 'mbc-typing');
      typing.hidden = true;
      body.append(line, log, typing, composer(), ended());
    }
    const atEnd = isAtEnd();
    drawMessages();
    const closed = conv.status === 'closed';
    panel.querySelector('.mbc-composer').hidden = closed;
    panel.querySelector('.mbc-ended').hidden = !closed;
    const line = panel.querySelector('.mbc-offline-line');
    line.hidden = closed || !avail || avail.status !== 'offline';
    line.textContent = T.offlineLine;
    if (atEnd) scrollEnd();
  }

  const isAtEnd = () => { const l = panel.querySelector('.mbc-log'); return !l || l.dataset.drawn !== '1' || l.scrollHeight - l.scrollTop - l.clientHeight < 80; };
  const scrollEnd = () => { const l = panel.querySelector('.mbc-log'); if (l) l.scrollTop = l.scrollHeight; };

  function drawMessages() {
    const log = panel.querySelector('.mbc-log');
    const readUpTo = conv.agent_read_id || 0;
    log.replaceChildren(...messages.map(m => {
      if (m.kind === 'system') return el('div', 'mbc-sys', m.body);
      const mine = m.kind === 'visitor';
      const row = el('div', `mbc-msg mbc-msg--${mine ? 'visitor' : 'agent'}`);
      if (!mine) row.appendChild(el('span', 'mbc-msg__who', m.author || T.team));
      row.appendChild(el('div', 'mbc-bubble', m.body));
      const meta = el('span', 'mbc-meta');
      if (m.failed) {
        meta.textContent = `${m.failed} `;
        const retry = el('button', 'mbc-link', T.retry);
        retry.type = 'button';
        retry.addEventListener('click', () => deliver(m));
        meta.appendChild(retry);
      } else if (m.pending) meta.textContent = T.sending;
      else {
        meta.appendChild(document.createTextNode(time(m.at)));
        if (mine) {
          const seen = m.id <= readUpTo;
          meta.classList.toggle('mbc-meta--read', seen);
          const icon = el('span');
          icon.innerHTML = seen ? ICON.ticks : ICON.tick;
          icon.style.display = 'inline-flex';
          icon.title = seen ? T.read : T.sent;
          icon.setAttribute('aria-label', icon.title);
          meta.appendChild(icon);
        }
      }
      row.appendChild(meta);
      return row;
    }));
    log.dataset.drawn = '1';
  }

  function composer() {
    const form = el('form', 'mbc-composer');
    form.innerHTML = `<textarea rows="1" maxlength="2000" placeholder="${T.write}" aria-label="${T.write}"></textarea>
      <button type="submit" class="mbc-send" aria-label="${T.send}" title="${T.send}" disabled>${ICON.send}</button>`;
    const input = form.querySelector('textarea'), btn = form.querySelector('button');
    const fit = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight + 2, 120)}px`; btn.disabled = !input.value.trim(); };
    input.addEventListener('input', () => {
      fit();
      if (input.value.trim() && Date.now() - lastTyping > TYPING_EVERY) { lastTyping = Date.now(); api('POST', '/chat/typing', {}).catch(() => {}); }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      fit();
      const m = { client_id: uuid(), kind: 'visitor', body: text, pending: true };
      messages.push(m);
      render();
      scrollEnd();
      deliver(m);
    });
    return form;
  }

  function ended() {
    const box = el('div', 'mbc-ended');
    box.appendChild(el('p', '', T.ended));
    const again = el('button', 'mbc-btn', T.again);
    again.type = 'button';
    again.addEventListener('click', () => { disconnect(); conv = null; messages = []; setUnread(0); render(); });
    box.appendChild(again);
    return box;
  }

  async function deliver(m) {
    m.failed = null;
    m.pending = true;
    render();
    try {
      const r = await api('POST', '/chat/messages', { body: m.body, client_id: m.client_id });
      merge(r.message);
    } catch (e) {
      m.pending = false;
      m.failed = errorText(e);
      if (e.code === 'chat_closed') refresh();
    }
    render();
  }

  /** One message, however many ways it arrives: by id, or as the answer to what was just sent. */
  function merge(m) {
    if (messages.some(x => x.id === m.id)) return false;
    const mine = m.client_id && messages.find(x => x.client_id === m.client_id);
    if (mine) { Object.assign(mine, m, { pending: false, failed: null }); return false; }
    messages.push(m);
    return true;
  }

  function incoming(m) {
    const isNew = merge(m);
    if (!isNew || m.kind === 'visitor') return;
    hideTyping();
    if (open && document.visibilityState === 'visible') markRead();
    else setUnread(unread + 1);
  }

  function markRead() {
    if (!conv) return;
    setUnread(0);
    const id = lastId();
    if (id) api('POST', '/chat/read', { last_id: id }).catch(() => {});
  }

  function showTyping(name) {
    const t = panel.querySelector('.mbc-typing');
    if (!t) return;
    t.replaceChildren(document.createTextNode(`${name || T.someone} ${T.typing}`), el('i'), el('i'), el('i'));
    t.hidden = false;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(hideTyping, TYPING_SHOWN);
  }
  function hideTyping() {
    clearTimeout(typingTimer);
    const t = panel && panel.querySelector('.mbc-typing');
    if (t) t.hidden = true;
  }

  /* ── Real time ──────────────────────────────────────────────────────────── */
  function disconnect() {
    clearTimeout(readyTimer);
    clearTimeout(pollTimer);
    if (es) { es.close(); es = null; }
  }

  function startPolling() {
    if (es) { es.close(); es = null; }
    polling = true;
    clearTimeout(pollTimer);
    const tick = async () => {
      await refresh();
      if (polling && isOpenChat() && document.visibilityState === 'visible') pollTimer = setTimeout(tick, POLL_MS);
    };
    pollTimer = setTimeout(tick, POLL_MS);
  }

  function connect() {
    disconnect();
    if (!isOpenChat() || document.visibilityState !== 'visible') return;
    if (polling || !window.EventSource) return startPolling();
    es = new EventSource(`/api/chat/stream?after=${lastId()}`);
    // A proxy that holds events back never lets "ready" through
    readyTimer = setTimeout(startPolling, READY_MS);
    es.addEventListener('ready', () => clearTimeout(readyTimer));
    es.addEventListener('message', e => { incoming(JSON.parse(e.data)); render(); });
    es.addEventListener('state', e => {
      conv = { ...conv, ...JSON.parse(e.data) };
      if (conv.status === 'closed') disconnect();
      render();
    });
    es.addEventListener('availability', e => { avail = JSON.parse(e.data); showAvailability(); render(); });
    es.addEventListener('typing', e => showTyping(JSON.parse(e.data).name));
    es.onerror = () => { if (es && es.readyState === EventSource.CLOSED) startPolling(); };
  }

  async function refresh() {
    if (!conv) return;
    try {
      const r = await api('GET', `/chat/messages?after=${lastId()}`);
      conv = { ...conv, ...r.conversation };
      avail = r.availability;
      r.messages.forEach(incoming);
      showAvailability();
      render();
    } catch { /* the next tick tries again */ }
  }

  document.addEventListener('visibilitychange', async () => {
    if (!root || !conv) return;
    if (document.visibilityState === 'hidden') return disconnect();
    await refresh();
    connect();
    if (open) markRead();
  });

  /* ── Start ──────────────────────────────────────────────────────────────── */
  async function init() {
    let s;
    try { s = await api('GET', `/chat/state?locale=${LANG}`); } catch { return; }
    if (!s.availability.enabled && !s.conversation) return;
    avail = s.availability;
    conv = s.conversation;
    messages = s.messages;
    prefill = s.prefill;
    build();
    showAvailability();
    if (conv) {
      setUnread(conv.unread);
      connect();
      if (isOpenChat()) setTimeout(() => api('POST', '/chat/page', { path: pagePath(), title: document.title.slice(0, 150) }).catch(() => {}), 1500);
    }
    if (store.get('mb_chat_open')) setOpen(true);
  }

  init();
})();
