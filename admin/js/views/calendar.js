// Availability calendar: month view per package (and option), bookings per
// day, bulk edits (capacity, block/unblock, notes, reset) with conflict checks.
import { $, addDays, badge, busy, date, esc, get, hashQuery, label, modal, put, setHashQuery, toast, today } from '../core.js';

const WD = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const REASONS = { past: 'Passado', lead_time: 'Antecedência mínima', too_far: 'Fora do horizonte de reservas', weekday_closed: 'Dia da semana fechado', out_of_season: 'Fora da época', blocked: 'Bloqueado' };
const UNIT_TXT = { pax: 'pessoas', unit: 'reservas (barco/viatura)', room: 'quartos' };

export default async function calendar(main) {
  const packages = await get('/admin/packages');
  const q = hashQuery();
  const t = today();
  const state = { id: q.get('id') || (packages[0] && packages[0].id), resource: q.get('resource') || '*', month: (q.get('month') || t.slice(0, 7)), data: null, sel: new Set(), anchor: null };

  main.innerHTML = `
    <div class="card" style="margin-bottom:18px;">
      <div class="filters">
        <label class="field" style="flex:3 1 280px;"><span>Pacote</span><select id="cal-pkg">${packages.map(p => `<option value="${esc(p.id)}">${esc(p.title)} (${label(p.kind)})</option>`).join('')}</select></label>
        <label class="field" id="cal-res-wrap" hidden><span>Opção / recurso</span><select id="cal-res"></select></label>
        <div class="field" style="flex:0 0 auto;"><span>Mês</span>
          <div style="display:flex;gap:4px;align-items:center;">
            <button type="button" class="icon-btn" id="prev" aria-label="Mês anterior"><i class='bx bx-chevron-left'></i></button>
            <strong id="month-label" style="min-width:140px;text-align:center;color:var(--primary);"></strong>
            <button type="button" class="icon-btn" id="next" aria-label="Mês seguinte"><i class='bx bx-chevron-right'></i></button>
          </div></div>
      </div>
    </div>
    <div class="cols">
      <div class="card"><div class="card__body">
        <div class="cal-legend" style="margin-bottom:12px;">
          <span><i style="background:#fff"></i>Disponível</span><span><i style="background:#FFF7ED;border-color:#FED7AA"></i>Limitado</span>
          <span><i style="background:#FEF2F2;border-color:#FECACA"></i>Esgotado</span><span><i style="background:#F1F5F9"></i>Fechado</span>
          <span class="muted">Clique num dia para seleccionar · Shift+clique para um intervalo</span>
        </div>
        <div class="cal" id="cal" role="grid" aria-label="Calendário de disponibilidade"></div>
      </div></div>
      <div class="stack">
        <div class="card"><div class="card__head"><h2>Modelo do pacote</h2><a class="link small" id="pkg-link" href="#">Editar</a></div><div class="card__body" id="model"></div></div>
        <div class="card"><div class="card__head"><h2>Alterar dias</h2></div><div class="card__body" id="editor"></div></div>
        <div class="card"><div class="card__head"><h2 id="day-title">Reservas do dia</h2></div><div class="card__body" id="day-info"><p class="muted" style="margin:0;">Seleccione um dia.</p></div></div>
      </div>
    </div>`;

  const pkgSel = $('#cal-pkg', main);
  pkgSel.value = state.id;

  async function load() {
    const [y, m] = state.month.split('-').map(Number);
    const from = `${state.month}-01`;
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    setHashQuery({ id: state.id, resource: state.resource !== '*' ? state.resource : '', month: state.month });
    $('#month-label', main).textContent = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    $('#cal', main).innerHTML = '<div class="skeleton" style="grid-column:1/-1"></div>';
    state.data = await get(`/admin/availability/${encodeURIComponent(state.id)}?from=${from}&to=${to}${state.resource !== '*' ? `&resource=${encodeURIComponent(state.resource)}` : ''}`);
    renderModel();
    renderCalendar();
    renderEditor();
    renderDay();
  }

  function renderModel() {
    const p = state.data.package;
    const a = p.availability;
    $('#pkg-link', main).href = `#/packages/${encodeURIComponent(p.id)}`;
    const resWrap = $('#cal-res-wrap', main);
    resWrap.hidden = !(a.per_option && p.options.length);
    if (!resWrap.hidden) {
      const sel = $('#cal-res', main);
      sel.innerHTML = p.options.map(o => `<option value="${esc(o.key)}">${esc(o.name)}</option>`).join('');
      if (state.resource === '*') { state.resource = p.options[0].key; }
      sel.value = state.resource;
    }
    $('#model', main).innerHTML = `<ul class="list-plain">
      <li><span class="muted">Capacidade conta</span><strong>${UNIT_TXT[a.unit] || a.unit}</strong></li>
      <li><span class="muted">Capacidade por defeito</span><strong>${a.default_capacity === null ? 'sem limite online' : a.default_capacity}</strong></li>
      ${a.unit === 'room' ? `<li><span class="muted">Pessoas por quarto</span><strong>${a.occupancy}</strong></li>` : ''}
      <li><span class="muted">Dias de operação</span><strong>${a.weekdays ? a.weekdays.map(d => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d]).join(', ') : 'todos'}</strong></li>
      <li><span class="muted">Época</span><strong>${a.seasons ? a.seasons.map(s => `${s.from} → ${s.to}`).join(', ') : 'todo o ano'}</strong></li>
    </ul>
    ${a.default_capacity === null ? '<p class="muted small" style="margin:8px 0 0;">Sem capacidade definida, os pedidos são aceites e a disponibilidade é confirmada manualmente. Defina a capacidade nos dias abaixo ou no pacote.</p>' : ''}`;
  }

  function renderCalendar() {
    const cal = $('#cal', main);
    const days = state.data.days;
    const first = (new Date(days[0].day + 'T12:00:00Z').getUTCDay() + 6) % 7;
    cal.innerHTML = WD.map(w => `<div class="cal__wd" role="columnheader">${w}</div>`).join('') + '<div class="cal__pad"></div>'.repeat(first) +
      days.map(d => {
        const n = Number(d.day.slice(8));
        const bk = d.bookings;
        const capTxt = d.status === 'closed' ? esc(REASONS[d.reason] || 'Fechado') : d.capacity === null ? 'sem limite' : `${d.remaining}/${d.capacity} livres`;
        return `<button type="button" class="cal__day cal__day--${d.status}${state.sel.has(d.day) ? ' is-selected' : ''}" data-day="${d.day}"
            aria-pressed="${state.sel.has(d.day)}" aria-label="${date(d.day)}: ${esc(label(d.status))}, ${capTxt}, ${bk.length} reserva(s)">
          <span class="cal__num">${n}${d.note ? `<i class='bx bx-note' title="${esc(d.note)}"></i>` : ''}</span>
          <span class="cal__meta">${capTxt}</span>
          ${bk.length ? `<span class="cal__bk">${bk.length} reserva(s) · ${bk.reduce((s, b) => s + b.quantity, 0)}</span>` : ''}
        </button>`;
      }).join('');
  }

  function renderDay() {
    const box = $('#day-info', main);
    if (state.sel.size !== 1) {
      $('#day-title', main).textContent = state.sel.size > 1 ? `${state.sel.size} dias seleccionados` : 'Reservas do dia';
      box.innerHTML = `<p class="muted" style="margin:0;">${state.sel.size > 1 ? 'Use “Alterar dias” para aplicar mudanças a todos os dias seleccionados.' : 'Seleccione um dia.'}</p>`;
      return;
    }
    const day = [...state.sel][0];
    const d = state.data.days.find(x => x.day === day);
    $('#day-title', main).textContent = date(day);
    box.innerHTML = `
      <p style="margin:0 0 8px;">${badge(d.status === 'full' ? 'cancelled' : d.status === 'closed' ? 'closed' : d.status === 'limited' ? 'pending' : 'confirmed')}
        ${d.reason ? esc(REASONS[d.reason] || d.reason) : d.capacity === null ? 'Sem limite online' : `${d.used} ocupados · ${d.remaining} livres de ${d.capacity}`}</p>
      ${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}
      ${d.bookings.length ? `<ul class="list-plain">${d.bookings.map(b => `<li><a href="#/bookings/${b.id}"><span class="t-strong mono">${esc(b.reference)}</span>
        <span class="t-sub">${esc(b.customer_name)} · ${b.adults + b.children} pessoa(s)</span></a>${badge(b.status)}</li>`).join('')}</ul>` : '<p class="muted" style="margin:0;">Sem reservas neste dia.</p>'}`;
  }

  function renderEditor() {
    const ed = $('#editor', main);
    const sel = [...state.sel].sort();
    const from = sel[0] || t;
    const to = sel[sel.length - 1] || t;
    ed.innerHTML = `
      <form id="days-form" class="grid" novalidate>
        <div class="grid grid--2">
          <label class="field"><span>De</span><input type="date" name="from" value="${from}" required></label>
          <label class="field"><span>Até</span><input type="date" name="to" value="${to}" required></label>
        </div>
        <fieldset class="field" style="border:0;padding:0;margin:0;"><span>Apenas nestes dias da semana <small>(opcional)</small></span>
          <div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="check" style="font-size:12.5px;"><input type="checkbox" name="weekdays" data-multi value="${d}">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d]}</label>`).join('')}</div></fieldset>
        <label class="field"><span>Acção</span><select name="op">
          <option value="capacity">Definir capacidade</option><option value="close">Bloquear (fechar) dias</option>
          <option value="open">Desbloquear dias</option><option value="note">Adicionar / alterar nota</option>
          <option value="reset">Repor valores por defeito</option></select></label>
        <label class="field" data-for="capacity"><span>Capacidade (${UNIT_TXT[state.data.package.availability.unit]})</span><input type="number" name="capacity" min="0" max="100000"><span class="field__hint">Vazio = sem limite online.</span></label>
        <label class="field" data-for="note close"><span>Nota <small>(visível só no painel)</small></span><input name="note" maxlength="300" placeholder="Ex.: Feriado, manutenção do barco"></label>
        <div class="form-actions"><button type="submit" class="btn btn--primary"><i class='bx bx-save'></i>Aplicar</button></div>
      </form>`;
    const f = $('#days-form', ed);
    const sync = () => f.querySelectorAll('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(f.op.value); });
    f.op.addEventListener('change', sync);
    sync();
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const weekdays = [...f.querySelectorAll('[name=weekdays]:checked')].map(i => Number(i.value));
      const body = { from: f.from.value, to: f.to.value, resource_key: state.resource, ...(weekdays.length ? { weekdays } : {}) };
      if (!body.from || !body.to || body.to < body.from) return toast('Indique um intervalo de datas válido.', 'error');
      if (f.op.value === 'capacity') body.capacity = f.capacity.value === '' ? null : Number(f.capacity.value);
      if (f.op.value === 'close') { body.closed = true; if (f.note.value) body.note = f.note.value; }
      if (f.op.value === 'open') body.closed = false;
      if (f.op.value === 'note') body.note = f.note.value || null;
      if (f.op.value === 'reset') body.reset = true;
      await apply(body, f.querySelector('[type=submit]'));
    });
  }

  async function apply(body, btn) {
    try {
      const r = await busy(btn, () => put(`/admin/availability/${encodeURIComponent(state.id)}/days`, body));
      toast(`${r.days} dia(s) actualizado(s).`);
      if (r.pending_on_days && r.pending_on_days.length) toast(`Atenção: há pedidos pendentes em ${r.pending_on_days.length} dia(s) — reveja-os.`);
      await load();
    } catch (err) {
      if (err.code !== 'availability_conflict') return;
      const list = (err.details || []).map(c => `<li>${date(c.day)}: ${c.confirmed} confirmado(s) — ${c.issue === 'capacity_below_confirmed' ? 'capacidade abaixo do já confirmado' : 'dia com reservas confirmadas'}</li>`).join('');
      const ok = await modal({
        title: 'Há reservas confirmadas nestes dias',
        body: `<p>As reservas existentes <strong>não são canceladas</strong> automaticamente. Reveja-as antes de continuar.</p><ul>${list}</ul>`,
        actions: [{ label: 'Voltar', value: null }, { label: 'Aplicar mesmo assim', kind: 'danger-solid', value: 'force' }],
      });
      if (ok) await apply({ ...body, force: true }, null);
    }
  }

  $('#cal', main).addEventListener('click', e => {
    const btn = e.target.closest('.cal__day');
    if (!btn) return;
    const day = btn.dataset.day;
    if (e.shiftKey && state.anchor) {
      const [a, b] = [state.anchor, day].sort();
      state.sel = new Set();
      for (let d = a; d <= b; d = addDays(d, 1)) state.sel.add(d);
    } else if (e.ctrlKey || e.metaKey) {
      state.sel.has(day) ? state.sel.delete(day) : state.sel.add(day);
      state.anchor = day;
    } else {
      state.sel = new Set([day]);
      state.anchor = day;
    }
    renderCalendar();
    renderEditor();
    renderDay();
  });
  pkgSel.addEventListener('change', () => { state.id = pkgSel.value; state.resource = '*'; state.sel.clear(); load(); });
  $('#cal-res', main).addEventListener('change', e => { state.resource = e.target.value; state.sel.clear(); load(); });
  const shift = n => {
    const [y, m] = state.month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    state.month = d.toISOString().slice(0, 7);
    state.sel.clear();
    load();
  };
  $('#prev', main).addEventListener('click', () => shift(-1));
  $('#next', main).addEventListener('click', () => shift(1));
  if (!state.id) { main.innerHTML = '<p class="muted">Ainda não há pacotes.</p>'; return; }
  await load();
}
