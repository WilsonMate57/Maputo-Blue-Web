// Live Chat: conversations, the open conversation, and who the visitor is.
// Everything people wrote goes through esc() or textContent.
import { $, $$, busy, confirmAction, date, debounce, del, emptyState, errorText, esc, get, label, modal, money, patch, post, toast } from '../core.js';
import { onChat, setSound, setViewing, soundOn } from '../chat-hub.js';

const FILTERS = [['all', 'Todas'], ['new', 'Novas'], ['unassigned', 'Não atribuídas'], ['active', 'Em atendimento'], ['waiting', 'Aguardando resposta'], ['closed', 'Encerradas']];
const STATUS = { new: 'Nova', active: 'Em atendimento', waiting: 'Aguardando resposta', closed: 'Encerrada' };
const SUBJECT = { bookings: 'Reservas e disponibilidade', packages: 'Pacotes turísticos', tours: 'Excursões e actividades', transfers: 'Transfers', accommodation: 'Alojamento', general: 'Informações gerais', other: 'Outros assuntos' };
const statusBadge = s => `<span class="chat-st chat-st--${esc(s)}">${esc(STATUS[s] || s)}</span>`;
const hour = d => new Date(d).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const when = d => {
  const t = new Date(d), now = new Date();
  return t.toDateString() === now.toDateString() ? hour(d) : t.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
};
const uuid = () => crypto.randomUUID();
const TYPING_EVERY = 3000;

export default async function chat(main, params, { user, setTitle }) {
  main.innerHTML = `
    <div class="chatv" id="chatv">
      <aside class="chatv__list">
        <div class="chatv__search"><i class='bx bx-search' aria-hidden="true"></i><input type="search" id="q" placeholder="Nome, e-mail, telefone ou CHAT-…" aria-label="Pesquisar conversas"></div>
        <div class="chatv__filters" id="filters" role="group" aria-label="Filtrar conversas"></div>
        <div class="chatv__items" id="items"></div>
      </aside>
      <section class="chatv__main" id="conv" aria-label="Conversa"></section>
      <aside class="chatv__info" id="info" aria-label="Informações do visitante"></aside>
    </div>`;

  const root = $('#chatv', main), itemsEl = $('#items', main), convEl = $('#conv', main), infoEl = $('#info', main);
  const state = { filter: 'all', q: '', items: [], counts: {}, id: params[0] || null, data: null, agents: [], replies: [], note: false, lastTyping: 0 };
  let typingTimer = null;

  /* ── List ─────────────────────────────────────────────────────────────── */
  function drawFilters() {
    $('#filters', main).innerHTML = FILTERS.map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${state.filter === k}">${l}<span class="chip__n">${state.counts[k] ?? 0}</span></button>`).join('');
    $$('[data-f]', main).forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.f; loadList(); }));
  }

  function drawList() {
    itemsEl.innerHTML = state.items.length ? state.items.map(c => `
      <button type="button" class="chat-item${c.id === state.id ? ' is-active' : ''}" data-id="${c.id}">
        <span class="chat-item__top"><span class="chat-item__name">${esc(c.name)}</span><span class="chat-item__time">${when(c.last_message_at)}</span></span>
        <span class="chat-item__subject">${esc(SUBJECT[c.subject] || c.subject)}</span>
        <span class="chat-item__preview">${c.last_sender === 'agent' ? 'Equipa: ' : ''}${esc(c.last_preview || '')}</span>
        <span class="chat-item__foot">${statusBadge(c.status)}<span class="chat-item__agent">${c.assigned_name ? `<i class='bx bx-user'></i>${esc(c.assigned_name)}` : 'Sem responsável'}</span>${c.unread_agent ? `<span class="chat-item__n" aria-label="${c.unread_agent} por ler">${c.unread_agent}</span>` : ''}</span>
      </button>`).join('') : emptyState('bx-message-rounded', state.q ? 'Nenhuma conversa com esta pesquisa.' : 'Sem conversas neste filtro.');
    $$('.chat-item', itemsEl).forEach(b => b.addEventListener('click', () => select(b.dataset.id)));
  }

  async function loadList() {
    const p = new URLSearchParams({ filter: state.filter });
    if (state.q) p.set('q', state.q);
    const r = await get(`/admin/chat/conversations?${p}`);
    Object.assign(state, { items: r.items, counts: r.counts });
    drawFilters();
    drawList();
  }
  const reloadList = debounce(() => loadList().catch(() => {}), 200);
  $('#q', main).addEventListener('input', debounce(e => { state.q = e.target.value.trim(); loadList().catch(() => {}); }, 250));

  /* ── Open conversation ────────────────────────────────────────────────── */
  async function select(id) {
    state.id = id;
    state.data = null;
    history.replaceState(null, '', id ? `#/chat/${id}` : '#/chat');
    setViewing(id);
    root.classList.toggle('is-open', !!id);
    root.classList.remove('is-info');
    drawList();
    if (!id) { drawEmpty(); return; }
    convEl.innerHTML = '<div class="chatv__loading"><i class="bx bx-loader-alt bx-spin"></i></div>';
    infoEl.innerHTML = '';
    try {
      await loadConversation();
      markRead();
    } catch (err) {
      convEl.innerHTML = `<div class="card__body"><p class="alert">${esc(errorText(err))}</p></div>`;
    }
  }

  function drawEmpty() {
    convEl.innerHTML = emptyState('bx-conversation', 'Escolha uma conversa para responder.');
    infoEl.innerHTML = '';
    setTitle('Live Chat');
  }

  async function loadConversation() {
    const id = state.id;
    const d = await get(`/admin/chat/conversations/${id}`);
    if (id !== state.id) return;
    const pending = state.data ? state.data.messages.filter(m => m.pending || m.failed) : [];
    state.data = d;
    d.messages.push(...pending.filter(p => !d.messages.some(m => m.client_id === p.client_id)));
    drawConversation();
    drawInfo();
  }

  function drawConversation() {
    const c = state.data.conversation;
    const draft = $('#reply', convEl) ? $('#reply', convEl).value : '';
    setTitle(`Live Chat · ${c.name}`);
    const closed = c.status === 'closed';
    const mine = c.assigned_to === user.id;
    convEl.innerHTML = `
      <header class="chatv__head">
        <button type="button" class="icon-btn chatv__back" id="back" aria-label="Voltar à lista"><i class='bx bx-arrow-back'></i></button>
        <div class="chatv__who"><h2>${esc(c.name)}</h2><p class="muted small">${esc(c.reference)} · ${esc(SUBJECT[c.subject] || c.subject)}${c.locale === 'en' ? ' · EN' : ''}</p></div>
        <div class="chatv__actions">
          ${!closed && !mine ? `<button type="button" class="btn btn--primary btn--sm" id="take"><i class='bx bx-user-check'></i>Assumir</button>` : ''}
          ${closed ? '' : `<label class="sr-only" for="assign">Responsável</label><select id="assign" class="chatv__select"><option value="">Sem responsável</option>${state.agents.map(a => `<option value="${a.id}"${a.id === c.assigned_to ? ' selected' : ''}>${esc(a.name)}${a.status === 'online' ? ' · online' : ''}</option>`).join('')}</select>
          <label class="sr-only" for="status">Estado</label><select id="status" class="chatv__select">${['new', 'active', 'waiting'].map(s => `<option value="${s}"${s === c.status ? ' selected' : ''}>${STATUS[s]}</option>`).join('')}</select>`}
          ${closed ? `<button type="button" class="btn btn--ghost btn--sm" id="reopen"><i class='bx bx-revision'></i>Reabrir</button>`
            : `<button type="button" class="btn btn--ghost btn--sm" id="close"><i class='bx bx-check-circle'></i>Encerrar</button>`}
          <button type="button" class="icon-btn chatv__info-btn" id="toggle-info" aria-label="Informações do visitante"><i class='bx bx-info-circle'></i></button>
        </div>
      </header>
      <div class="chatv__log" id="log" role="log" aria-live="polite"></div>
      <div class="chatv__typing" id="typing" hidden></div>
      ${closed ? `<p class="chatv__closed muted small">Conversa encerrada. Pode acrescentar notas internas; para responder, reabra a conversa.</p>` : ''}
      <form class="chatv__composer${state.note || closed ? ' is-note' : ''}" id="composer">
        <div class="chatv__tools">
          <div class="seg" role="group" aria-label="Tipo de mensagem">
            ${closed ? '' : `<button type="button" data-note="0" aria-pressed="${!state.note}">Resposta</button>`}
            <button type="button" data-note="1" aria-pressed="${state.note || closed}"><i class='bx bx-lock-alt'></i>Nota interna</button>
          </div>
          <button type="button" class="btn btn--ghost btn--sm" id="quick"><i class='bx bx-bolt-circle'></i>Respostas rápidas</button>
          <button type="button" class="icon-btn" id="sound" aria-label="Som das notificações" aria-pressed="${soundOn()}" title="Som das notificações"><i class='bx ${soundOn() ? 'bx-bell' : 'bx-bell-off'}'></i></button>
        </div>
        <div class="chatv__write">
          <textarea id="reply" rows="2" maxlength="2000" placeholder="${state.note || closed ? 'Nota interna: o visitante nunca a vê' : 'Escreva a resposta. Enter envia, Shift + Enter muda de linha'}" aria-label="Mensagem"></textarea>
          <button type="submit" class="btn btn--primary" aria-label="Enviar"><i class='bx bx-send'></i></button>
        </div>
      </form>`;
    $('#reply', convEl).value = draft;
    drawMessages(true);
    wireConversation(c);
  }

  function drawMessages(toEnd) {
    const log = $('#log', convEl);
    if (!log) return;
    const stick = toEnd || log.scrollHeight - log.scrollTop - log.clientHeight < 90;
    const c = state.data.conversation;
    log.innerHTML = state.data.messages.map((m, i) => {
      if (m.kind === 'system') return `<div class="chat-sys">${esc(m.body)}</div>`;
      const note = m.kind === 'note', visitor = m.kind === 'visitor';
      const seen = !visitor && !note && m.id && m.id <= c.visitor_read_id;
      const meta = m.failed ? `<span class="chat-fail">${esc(m.failed)} <button type="button" class="link-btn" data-retry="${i}">Tentar de novo</button></span>`
        : m.pending ? 'A enviar…' : `${hour(m.at)}${!visitor && !note ? ` · ${seen ? 'Visto' : 'Enviado'}` : ''}`;
      return `<div class="chat-msg chat-msg--${note ? 'note' : visitor ? 'visitor' : 'agent'}">
        <span class="chat-msg__who">${note ? `<i class='bx bx-lock-alt'></i>Nota interna · ` : ''}${esc(visitor ? c.name : m.author || user.name)}</span>
        <div class="chat-msg__body">${esc(m.body)}</div><span class="chat-msg__meta">${meta}</span></div>`;
    }).join('');
    $$('[data-retry]', log).forEach(b => b.addEventListener('click', () => deliver(state.data.messages[Number(b.dataset.retry)])));
    if (stick) log.scrollTop = log.scrollHeight;
  }

  function wireConversation(c) {
    const act = async (btn, fn, ok) => {
      try {
        await busy(btn, fn, ok);
        await Promise.all([loadConversation(), loadList()]);
      } catch { await loadConversation().catch(() => {}); }
    };
    const on = (id, ev, fn) => { const n = $(id, convEl); if (n) n.addEventListener(ev, fn); };
    on('#back', 'click', () => select(null));
    on('#toggle-info', 'click', () => root.classList.toggle('is-info'));
    on('#take', 'click', e => act(e.currentTarget, () => post(`/admin/chat/conversations/${c.id}/assign`, {}), 'A conversa é agora sua.'));
    on('#assign', 'change', e => act(null, () => post(`/admin/chat/conversations/${c.id}/assign`, { user_id: e.target.value || null }), 'Responsável actualizado.'));
    on('#status', 'change', e => act(null, () => post(`/admin/chat/conversations/${c.id}/status`, { status: e.target.value }), 'Estado actualizado.'));
    on('#reopen', 'click', e => act(e.currentTarget, () => post(`/admin/chat/conversations/${c.id}/status`, { status: c.assigned_to ? 'active' : 'new' }), 'Conversa reaberta.'));
    on('#close', 'click', async e => {
      const btn = e.currentTarget;
      if (await confirmAction({ title: 'Encerrar atendimento', text: `A conversa com <strong>${esc(c.name)}</strong> termina e o visitante é informado. Pode reabri-la depois.`, confirm: 'Encerrar' }))
        act(btn, () => post(`/admin/chat/conversations/${c.id}/status`, { status: 'closed' }), 'Conversa encerrada.');
    });
    on('#quick', 'click', openQuickReplies);
    on('#sound', 'click', e => {
      const v = !soundOn();
      setSound(v);
      e.currentTarget.setAttribute('aria-pressed', String(v));
      e.currentTarget.querySelector('i').className = `bx ${v ? 'bx-bell' : 'bx-bell-off'}`;
    });
    $$('[data-note]', convEl).forEach(b => b.addEventListener('click', () => { state.note = b.dataset.note === '1'; drawConversation(); $('#reply', convEl).focus(); }));

    const input = $('#reply', convEl), form = $('#composer', convEl);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    input.addEventListener('input', () => {
      if (!state.note && c.status !== 'closed' && input.value.trim() && Date.now() - state.lastTyping > TYPING_EVERY) {
        state.lastTyping = Date.now();
        post(`/admin/chat/conversations/${c.id}/typing`).catch(() => {});
      }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      const note = state.note || c.status === 'closed';
      const m = { client_id: uuid(), kind: note ? 'note' : 'agent', body, author: user.name, pending: true, note };
      state.data.messages.push(m);
      drawMessages(true);
      deliver(m);
    });
  }

  async function deliver(m) {
    m.pending = true;
    m.failed = null;
    drawMessages();
    const id = state.id;
    try {
      const r = await post(`/admin/chat/conversations/${id}/messages`, { body: m.body, client_id: m.client_id, note: !!m.note });
      if (id === state.id) { merge(r.message); drawMessages(true); }
      reloadList();
    } catch (err) {
      m.pending = false;
      m.failed = errorText(err);
      drawMessages();
    }
  }

  /** The same message may come back twice: as the answer and through the stream. */
  function merge(m) {
    const list = state.data.messages;
    const mine = m.client_id && list.find(x => x.client_id === m.client_id);
    if (mine) { Object.assign(mine, m, { pending: false, failed: null }); return; }
    if (!list.some(x => x.id === m.id)) list.push(m);
  }

  function markRead() {
    if (state.id && document.visibilityState === 'visible') post(`/admin/chat/conversations/${state.id}/read`).catch(() => {});
  }

  function showTyping(text) {
    const t = $('#typing', convEl);
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  /* ── Quick replies ────────────────────────────────────────────────────── */
  async function openQuickReplies() {
    const { items } = await get('/admin/chat/replies');
    state.replies = items;
    const c = state.data.conversation;
    const text = r => (c.locale === 'en' && r.body_en) || r.body;
    const res = await modal({
      title: 'Respostas rápidas', wide: true,
      body: `<div class="quick-list">${items.map(r => `<div class="quick-row">
          <button type="button" class="quick-use" data-use="${r.id}"><b>${esc(r.title)}</b><span>${esc(text(r))}</span></button>
          <button type="button" class="icon-btn" data-edit="${r.id}" aria-label="Editar ${esc(r.title)}"><i class='bx bx-pencil'></i></button>
          <button type="button" class="icon-btn" data-del="${r.id}" aria-label="Apagar ${esc(r.title)}"><i class='bx bx-trash'></i></button></div>`).join('') || '<p class="muted">Ainda não há respostas rápidas.</p>'}</div>`,
      actions: [{ label: 'Fechar', value: null }, { label: 'Nova resposta', kind: 'primary', value: 'new' }],
      onOpen: dlg => {
        $$('[data-use]', dlg).forEach(b => b.addEventListener('click', () => {
          const input = $('#reply', convEl);
          input.value = (input.value ? `${input.value}\n` : '') + text(items.find(r => r.id === b.dataset.use));
          dlg.close();
          input.focus();
        }));
        $$('[data-edit]', dlg).forEach(b => b.addEventListener('click', () => { dlg.close(); setTimeout(() => editReply(items.find(r => r.id === b.dataset.edit)), 0); }));
        $$('[data-del]', dlg).forEach(b => b.addEventListener('click', async () => {
          try { await del(`/admin/chat/replies/${b.dataset.del}`); b.closest('.quick-row').remove(); toast('Resposta apagada.'); } catch (err) { toast(errorText(err), 'error'); }
        }));
      },
    });
    if (res && res.action === 'new') editReply(null);
  }

  async function editReply(r) {
    await modal({
      title: r ? 'Editar resposta rápida' : 'Nova resposta rápida',
      body: `<label class="field"><span>Nome</span><input name="title" maxlength="80" value="${esc(r ? r.title : '')}"></label>
        <label class="field"><span>Texto (PT)</span><textarea name="body" rows="4" maxlength="2000">${esc(r ? r.body : '')}</textarea></label>
        <label class="field"><span>Text (EN)</span><textarea name="body_en" rows="4" maxlength="2000">${esc(r ? r.body_en : '')}</textarea></label>`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar', kind: 'primary', value: 'ok', submit: true,
        validate: v => (!v.title.trim() || !v.body.trim() ? 'Indique o nome e o texto em português.' : ''),
        run: v => (r ? patch(`/admin/chat/replies/${r.id}`, v) : post('/admin/chat/replies', v)) }],
    });
  }

  /* ── Visitor information ──────────────────────────────────────────────── */
  function drawInfo() {
    const { conversation: c, context: x } = state.data;
    const row = (l, v) => (v ? `<div class="chat-kv"><span>${l}</span><strong>${v}</strong></div>` : '');
    const link = (hash, text) => `<a href="#${hash}" target="_blank" rel="noopener">${esc(text)}<i class='bx bx-link-external'></i></a>`;
    const unlink = key => `<button type="button" class="icon-btn" data-unlink="${key}" aria-label="Retirar associação"><i class='bx bx-unlink'></i></button>`;
    const page = c.current_title || c.current_path;
    const same = x.same_email;
    const hints = [
      same.customer ? `<li><span>Conta com este e-mail: ${esc(same.customer.name)}</span><button type="button" class="link-btn" data-link-user="${same.customer.id}">Associar</button></li>` : '',
      ...same.bookings.map(b => `<li><span>${link(`/bookings/${b.id}`, b.reference)} ${esc(label(b.status))}</span><button type="button" class="link-btn" data-link-booking="${esc(b.reference)}">Associar</button></li>`),
      ...same.quotes.map(q => `<li><span>${link(`/quotations/${q.id}`, q.number)} ${esc(label(q.status))}</span><button type="button" class="link-btn" data-link-quote="${esc(q.number)}">Associar</button></li>`),
    ].join('');
    infoEl.innerHTML = `
      <div class="chat-card"><h3>Visitante</h3>
        ${row('Nome', esc(c.name))}${row('E-mail', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`)}${row('Telefone', c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a>` : '')}
        ${row('Assunto', esc(SUBJECT[c.subject] || c.subject))}${row('Início', `${date(c.created_at)} ${hour(c.created_at)}`)}
        ${c.started_offline ? '<p class="muted small" style="margin:8px 0 0;">Mensagem deixada com a equipa offline.</p>' : ''}
      </div>
      <div class="chat-card"><h3>Página</h3>
        ${page ? `<p class="chat-page">${esc(page)}</p>${c.current_path ? `<a class="small" href="${esc(c.current_path)}" target="_blank" rel="noopener">Abrir a página<i class='bx bx-link-external'></i></a>` : ''}` : '<p class="muted small">Sem registo.</p>'}
      </div>
      <div class="chat-card"><h3>Associações</h3>
        <div class="chat-link"><span>Pacote</span>${x.package ? `<div>${link(`/packages/${x.package.id}`, x.package.title || x.package.id)}${unlink('package_id')}</div>` : '<button type="button" class="link-btn" data-add="package">Associar</button>'}</div>
        <div class="chat-link"><span>Reserva</span>${x.booking ? `<div>${link(`/bookings/${x.booking.id}`, x.booking.reference)}${unlink('booking_reference')}</div><small>${esc(x.booking.package_title || '')} · ${esc(label(x.booking.status))} · ${date(x.booking.start_date)} · ${esc(money(x.booking.total, x.booking.currency))}</small>` : '<button type="button" class="link-btn" data-add="booking">Associar</button>'}</div>
        <div class="chat-link"><span>Cotação</span>${x.quote ? `<div>${link(`/quotations/${x.quote.id}`, x.quote.number)}${unlink('quote_number')}</div><small>v${x.quote.version} · ${esc(label(x.quote.status))} · ${esc(money(x.quote.total, x.quote.currency))}</small>` : '<button type="button" class="link-btn" data-add="quote">Associar</button>'}</div>
        <div class="chat-link"><span>Cliente</span>${x.customer ? `<div>${link(`/customers/${x.customer.id}`, x.customer.name)}${unlink('user_id')}</div><small>${esc(x.customer.email)}</small>` : '<small class="muted">Sem conta associada</small>'}</div>
      </div>
      ${hints ? `<div class="chat-card chat-card--hint"><h3>Com o mesmo e-mail</h3><p class="muted small">O e-mail foi escrito pelo visitante e não confirma a identidade. Confirme antes de partilhar dados.</p><ul class="chat-hints">${hints}</ul></div>` : ''}`;

    const setLinks = async body => {
      try {
        const r = await patch(`/admin/chat/conversations/${c.id}/links`, body);
        state.data.conversation = r.conversation;
        state.data.context = r.context;
        drawInfo();
      } catch (err) { toast(errorText(err), 'error'); }
    };
    $$('[data-unlink]', infoEl).forEach(b => b.addEventListener('click', () => setLinks({ [b.dataset.unlink]: null })));
    $$('[data-link-user]', infoEl).forEach(b => b.addEventListener('click', () => setLinks({ user_id: b.dataset.linkUser })));
    $$('[data-link-booking]', infoEl).forEach(b => b.addEventListener('click', () => setLinks({ booking_reference: b.dataset.linkBooking })));
    $$('[data-link-quote]', infoEl).forEach(b => b.addEventListener('click', () => setLinks({ quote_number: b.dataset.linkQuote })));
    $$('[data-add]', infoEl).forEach(b => b.addEventListener('click', async () => {
      const kind = b.dataset.add;
      let field = `<label class="field"><span>${kind === 'booking' ? 'Referência da reserva (MB-…)' : 'Número da cotação (COT-…)'}</span><input name="v" maxlength="30"></label>`;
      if (kind === 'package') {
        const list = await get('/admin/packages');
        field = `<label class="field"><span>Pacote</span><select name="v"><option value="">Escolha</option>${list.filter(p => p.status === 'published').map(p => `<option value="${esc(p.id)}">${esc(p.title || p.id)}</option>`).join('')}</select></label>`;
      }
      const key = { package: 'package_id', booking: 'booking_reference', quote: 'quote_number' }[kind];
      const r = await modal({ title: 'Associar à conversa', body: field, actions: [{ label: 'Cancelar', value: null }, { label: 'Associar', kind: 'primary', value: 'ok', submit: true }] });
      if (r && r.values.v.trim()) setLinks({ [key]: r.values.v.trim() });
    }));
  }

  /* ── Live updates ─────────────────────────────────────────────────────── */
  const off = onChat(evt => {
    if (!main.isConnected) { off(); return; }
    if (['new', 'message', 'state', 'read', 'resync'].includes(evt.t)) reloadList();
    if (!state.id || !state.data) return;
    if (evt.t === 'resync') { loadConversation().then(markRead).catch(() => {}); return; }
    if (evt.c !== state.id) return;
    if (evt.t === 'message' && evt.message) {
      merge(evt.message);
      if (evt.kind === 'visitor') { $('#typing', convEl) && ($('#typing', convEl).hidden = true); markRead(); }
      if (evt.kind === 'system') loadConversation().catch(() => {});
      else drawMessages();
    }
    if (evt.t === 'state') loadConversation().catch(() => {});
    if (evt.t === 'read' && evt.by === 'visitor') loadConversation().catch(() => {});
    if (evt.t === 'typing') {
      if (evt.who === 'visitor') showTyping(`${state.data.conversation.name} está a escrever…`);
      else if (evt.by !== user.id) showTyping(`${evt.name} está a escrever…`);
    }
  });
  const onVisible = () => { if (!main.isConnected) { document.removeEventListener('visibilitychange', onVisible); setViewing(null); return; } if (document.visibilityState === 'visible') markRead(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('hashchange', function leave() { if (!/^#\/chat/.test(location.hash)) setViewing(null); window.removeEventListener('hashchange', leave); });

  const r = await get('/admin/chat/agents');
  state.agents = r.items;
  await loadList();
  if (state.id) await select(state.id); else drawEmpty();
}
