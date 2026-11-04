// Proposal builder: five steps in one screen, with the totals always visible.
// The totals here are only a preview: the server computes the real ones.
import { $, $$, addDays, busy, debounce, errorText, esc, get, hashQuery, modal, money, patch, post, toast, today } from '../core.js';

const CLIENT_TYPES = { individual: 'Individual', group: 'Grupo', company: 'Empresa', agency: 'Agência', other: 'Outro' };
const CURRENCIES = ['MZN', 'USD', 'ZAR', 'EUR'];
const STEPS = ['Cliente', 'Viagem', 'Serviços', 'Condições', 'Rever'];

const cents = n => Math.round(Number(n || 0) * 100);
const discountOf = (d, base) => {
  if (!d || !Number(d.value)) return 0;
  const c = d.kind === 'percent' ? Math.round(base * Math.min(Number(d.value), 100) / 100) : cents(d.value);
  return Math.min(Math.max(c, 0), base);
};
function totals(s) {
  const lines = s.items.map(i => { const g = Math.round(cents(i.unit_price) * Number(i.quantity || 0)); return { g, d: discountOf(i.discount, g) }; });
  const sub = lines.reduce((a, l) => a + l.g, 0), lineDisc = lines.reduce((a, l) => a + l.d, 0);
  const global = discountOf(s.discount, sub - lineDisc);
  const fees = s.fees.reduce((a, f) => a + (f.label ? cents(f.amount) : 0), 0);
  return { lines: lines.map(l => (l.g - l.d) / 100), subtotal: sub / 100, discount: (lineDisc + global) / 100, fees: fees / 100, total: (sub - lineDisc - global + fees) / 100 };
}

const blankItem = () => ({ kind: 'custom', description: '', details: '', date_from: '', date_to: '', quantity: 1, participants: null, unit_price: null, discount: null });
const input = (label, name, value, attrs = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;
const area = (label, name, value, rows = 3, hint = '') => `<label class="field"><span>${label}</span><textarea name="${name}" rows="${rows}" maxlength="3000">${esc(value ?? '')}</textarea>${hint ? `<span class="field__hint">${hint}</span>` : ''}</label>`;
const setPath = (o, path, v) => { const k = path.split('.'); const last = k.pop(); k.reduce((x, p) => x[p], o)[last] = v; };

export default async function quotationEdit(main, [id], { setTitle }) {
  const query = hashQuery();
  const builder = await get('/admin/quotations/builder');
  const cfg = builder.settings;
  const term = (key, locale) => (locale === 'en' ? cfg[`${key}_en`] || '' : cfg[key] || '');
  const s = {
    request_id: null, locale: 'pt', currency: 'MZN', valid_until: addDays(today(), Number(cfg.validity_days) || 14),
    customer: { name: '', company: '', email: '', phone: '', country: '', client_type: 'individual', nuit: '', address: '' },
    trip: { destination: '', date_from: '', date_to: '', days: null, nights: null, adults: 2, children: 0, experience: '', customer_notes: '' },
    items: [], discount: null, fees: [], itinerary: [], internal_notes: '', message: '',
    inclusions: term('inclusions'), exclusions: term('exclusions'), payment_terms: term('payment_terms'), deposit_percent: cfg.deposit_percent ?? null,
    payment_due: '', cancellation_terms: term('cancellation_terms'), special_conditions: '',
  };
  let quoteId = id || null;
  let label = 'Nova cotação';

  if (quoteId) {
    const { quote: q } = await get(`/admin/quotations/${quoteId}`);
    if (q.status !== 'draft') { location.hash = `#/quotations/${q.id}`; return; }
    label = `${q.number}${q.version > 1 ? ` v${q.version}` : ''}`;
    for (const k of Object.keys(s)) if (q[k] !== undefined && q[k] !== null) s[k] = q[k];
    s.customer = { ...s.customer, ...q.customer };
    s.trip = { ...s.trip, ...q.trip };
  } else if (query.get('request')) {
    const rid = query.get('request');
    const [{ request: r }, sug] = await Promise.all([get(`/admin/requests/${rid}`), get(`/admin/requests/${rid}/quote-suggestion`)]);
    s.request_id = r.id;
    s.locale = r.locale === 'en' ? 'en' : 'pt';
    s.currency = sug.currency;
    s.customer = { ...s.customer, name: r.name, email: r.email, phone: r.phone, company: r.billing?.company_name || '', nuit: r.billing?.nuit || '', address: r.billing?.address || '',
      client_type: r.billing?.company_name ? 'company' : 'individual' };
    s.trip = { ...s.trip, destination: r.destination || '', date_from: r.date_from || '', date_to: r.date_to || '', adults: r.adults, children: r.children, customer_notes: r.special_requests || '' };
    s.items = sug.lines.map(l => ({ ...blankItem(), kind: l.kind || 'custom', package_id: l.package_id, service_key: l.service_key, description: l.description, date_from: l.date_from || '', unit_price: l.unit_price }));
    label = `Cotação para ${r.reference}`;
  }
  setTitle(label);

  let step = quoteId ? 2 : 0;
  main.innerHTML = `
    <a class="back" href="#/quotations"><i class='bx bx-arrow-back'></i>Cotações e propostas</a>
    <ol class="steps" id="steps">${STEPS.map((t, i) => `<li data-step="${i}" tabindex="0" role="button">${t}</li>`).join('')}</ol>
    <div class="cols">
      <form id="qf" novalidate><div class="card"><div class="card__body" id="panel"></div></div>
        <div class="form-actions form-actions--start" style="margin-top:14px;">
          <button type="button" class="btn btn--ghost" id="prev"><i class='bx bx-chevron-left'></i>Anterior</button>
          <button type="button" class="btn btn--secondary" id="next">Seguinte<i class='bx bx-chevron-right'></i></button>
        </div></form>
      <aside class="card quote-summary"><div class="card__head"><h2>Resumo</h2></div><div class="card__body" id="summary"></div></aside>
    </div>`;
  const panel = $('#panel', main);

  /* ── Steps ─────────────────────────────────────────────────────────────── */
  const stepCustomer = () => `
    <h3 class="quote-h">Dados do cliente</h3>
    <label class="field"><span>Procurar cliente existente</span><input id="csearch" type="search" placeholder="Nome, e-mail, empresa ou telefone" autocomplete="off"></label>
    <div id="cresults" class="quote-results" hidden></div>
    <div class="grid grid--2" style="margin-top:14px;">
      ${input('Nome completo', 'customer.name', s.customer.name, 'maxlength="160" autocomplete="off"')}
      ${input('Empresa <small>(opcional)</small>', 'customer.company', s.customer.company, 'maxlength="160" autocomplete="off"')}
      ${input('E-mail', 'customer.email', s.customer.email, 'type="email" maxlength="200" autocomplete="off"')}
      ${input('Telefone', 'customer.phone', s.customer.phone, 'maxlength="40" autocomplete="off"')}
      ${input('País', 'customer.country', s.customer.country, 'maxlength="80"')}
      <label class="field"><span>Tipo de cliente</span><select name="customer.client_type">${Object.entries(CLIENT_TYPES).map(([k, v]) => `<option value="${k}"${s.customer.client_type === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      ${input('NUIT <small>(opcional)</small>', 'customer.nuit', s.customer.nuit, 'maxlength="40"')}
      ${input('Morada <small>(opcional)</small>', 'customer.address', s.customer.address, 'maxlength="300"')}
    </div>
    <div style="margin-top:14px;">${area('Observações internas', 'internal_notes', s.internal_notes, 2, 'Só a equipa vê. Nunca aparecem no PDF nem na página do cliente.')}</div>`;

  const stepTrip = () => `
    <h3 class="quote-h">Informações da viagem</h3>
    <div class="grid grid--2">
      ${input('Destino', 'trip.destination', s.trip.destination, 'maxlength="200"')}
      ${input('Tipo de experiência', 'trip.experience', s.trip.experience, 'maxlength="200"')}
      ${input('Chegada prevista', 'trip.date_from', s.trip.date_from, 'type="date"')}
      ${input('Partida prevista', 'trip.date_to', s.trip.date_to, 'type="date"')}
      ${input('Dias', 'trip.days', s.trip.days, 'type="number" min="0" max="1000" data-num')}
      ${input('Noites', 'trip.nights', s.trip.nights, 'type="number" min="0" max="1000" data-num')}
      ${input('Adultos', 'trip.adults', s.trip.adults, 'type="number" min="0" max="1000" data-num')}
      ${input('Crianças', 'trip.children', s.trip.children, 'type="number" min="0" max="1000" data-num')}
      <label class="field"><span>Idioma da proposta</span><select name="locale"><option value="pt"${s.locale === 'pt' ? ' selected' : ''}>Português</option><option value="en"${s.locale === 'en' ? ' selected' : ''}>English</option></select></label>
    </div>
    <div style="margin-top:14px;">${area('Observações do cliente', 'trip.customer_notes', s.trip.customer_notes, 3, 'Aparecem na proposta.')}</div>`;

  const itemRow = (it, i) => `
    <div class="repeat__row" data-i="${i}">
      <div>
        <div class="quote-line__head"><span class="badge badge--plain">${{ package: 'Catálogo', service: 'Serviço', custom: 'Personalizado' }[it.kind || 'custom']}</span>
          <strong class="mono" data-line-total></strong></div>
        <div class="repeat__fields quote-line">
          <label class="field span-all"><span>Serviço</span><input data-f="description" value="${esc(it.description)}" maxlength="300"></label>
          <label class="field span-all"><span>Descrição</span><input data-f="details" value="${esc(it.details || '')}" maxlength="1000"></label>
          <label class="field"><span>Data</span><input type="date" data-f="date_from" value="${esc(it.date_from || '')}"></label>
          <label class="field"><span>Até</span><input type="date" data-f="date_to" value="${esc(it.date_to || '')}"></label>
          <label class="field"><span>Quantidade</span><input type="number" min="0" step="any" data-f="quantity" value="${it.quantity ?? 1}"></label>
          <label class="field"><span>Participantes</span><input type="number" min="0" data-f="participants" value="${it.participants ?? ''}"></label>
          <label class="field"><span>Preço unitário</span><input type="number" min="0" step="0.01" data-f="unit_price" value="${it.unit_price ?? ''}"${it.unit_price === null || it.unit_price === undefined ? ' class="is-invalid"' : ''}></label>
          <label class="field"><span>Desconto</span><span class="quote-discount"><input type="number" min="0" step="0.01" data-f="discount_value" value="${it.discount?.value ?? ''}">
            <select data-f="discount_kind" aria-label="Tipo de desconto"><option value="percent"${it.discount?.kind !== 'fixed' ? ' selected' : ''}>%</option><option value="fixed"${it.discount?.kind === 'fixed' ? ' selected' : ''}>${esc(s.currency)}</option></select></span></label>
        </div>
      </div>
      <div class="repeat__ctrl"><button type="button" class="icon-btn" data-remove="${i}" aria-label="Remover serviço" title="Remover"><i class='bx bx-trash'></i></button></div>
    </div>`;

  const stepServices = () => `
    <div class="quote-toolbar"><h3 class="quote-h" style="margin:0;">Composição da proposta</h3>
      <div class="page-head__actions">
        <button type="button" class="btn btn--secondary btn--sm" id="add-cat"><i class='bx bx-package'></i>Do catálogo</button>
        <button type="button" class="btn btn--ghost btn--sm" id="add-custom"><i class='bx bx-plus'></i>Serviço personalizado</button></div></div>
    <div class="grid grid--3" style="margin:14px 0;">
      <label class="field"><span>Moeda</span><select name="currency">${CURRENCIES.map(c => `<option${s.currency === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field"><span>Válida até</span><input type="date" name="valid_until" value="${esc(s.valid_until)}"></label>
    </div>
    <div class="repeat" id="items">${s.items.map(itemRow).join('') || `<p class="muted" style="margin:0;">Adicione serviços do catálogo ou serviços personalizados. Os personalizados ficam só nesta cotação e não alteram o catálogo.</p>`}</div>`;

  const feeRow = (f, i) => `<div class="repeat__row" data-fee="${i}"><div class="repeat__fields">
      <label class="field"><span>Taxa adicional</span><input data-k="label" value="${esc(f.label || '')}" maxlength="120"></label>
      <label class="field"><span>Valor (${esc(s.currency)})</span><input type="number" min="0" step="0.01" data-k="amount" value="${f.amount ?? ''}"></label></div>
    <div class="repeat__ctrl"><button type="button" class="icon-btn" data-remove-fee="${i}" aria-label="Remover taxa"><i class='bx bx-trash'></i></button></div></div>`;
  const stopRow = (t, i) => `<div class="repeat__row" data-stop="${i}"><div class="repeat__fields">
      <label class="field"><span>Etapa</span><input data-k="title" value="${esc(t.title || '')}" maxlength="200"></label>
      <label class="field span-all"><span>Descrição</span><textarea data-k="description" rows="2" maxlength="2000">${esc(t.description || '')}</textarea></label></div>
    <div class="repeat__ctrl"><button type="button" class="icon-btn" data-remove-stop="${i}" aria-label="Remover etapa"><i class='bx bx-trash'></i></button></div></div>`;

  const stepTerms = () => `
    <h3 class="quote-h">Condições comerciais</h3>
    <div class="grid grid--3">
      <label class="field"><span>Desconto global</span><span class="quote-discount"><input type="number" min="0" step="0.01" id="gdisc" value="${s.discount?.value ?? ''}">
        <select id="gdisc-kind" aria-label="Tipo de desconto"><option value="percent"${s.discount?.kind !== 'fixed' ? ' selected' : ''}>%</option><option value="fixed"${s.discount?.kind === 'fixed' ? ' selected' : ''}>${esc(s.currency)}</option></select></span></label>
      ${input('Depósito exigido (%)', 'deposit_percent', s.deposit_percent, 'type="number" min="0" max="100" step="0.01" data-num')}
      ${input('Prazo para pagamento', 'payment_due', s.payment_due, 'maxlength="300"')}
    </div>
    <div class="repeat" id="fees" style="margin-top:14px;">${s.fees.map(feeRow).join('')}</div>
    <button type="button" class="btn btn--ghost btn--sm" id="add-fee" style="margin-top:8px;"><i class='bx bx-plus'></i>Taxa adicional</button>
    <div class="grid grid--2" style="margin-top:14px;">
      ${area('Serviços incluídos', 'inclusions', s.inclusions)}
      ${area('Serviços não incluídos', 'exclusions', s.exclusions)}
      ${area('Condições de pagamento', 'payment_terms', s.payment_terms)}
      ${area('Política de cancelamento', 'cancellation_terms', s.cancellation_terms)}
      ${area('Observações e condições especiais', 'special_conditions', s.special_conditions)}
      ${area('Mensagem ao cliente', 'message', s.message)}
    </div>
    <h3 class="quote-h" style="margin-top:18px;">Itinerário</h3>
    <div class="repeat" id="stops">${s.itinerary.map(stopRow).join('')}</div>
    <button type="button" class="btn btn--ghost btn--sm" id="add-stop" style="margin-top:8px;"><i class='bx bx-plus'></i>Etapa</button>`;

  const stepReview = () => {
    const t = totals(s);
    const missing = [
      !s.customer.name && 'Indique o nome do cliente.', !s.customer.email && 'Indique o e-mail do cliente.', !s.customer.phone && 'Indique o telefone do cliente.',
      !s.items.length && 'Adicione pelo menos um serviço.', s.items.some(i => i.unit_price === null || i.unit_price === undefined || i.unit_price === '') && 'Há serviços sem preço.',
      s.items.some(i => !i.description) && 'Há serviços sem nome.', s.valid_until < today() && 'A data de validade já passou.',
    ].filter(Boolean);
    return `
      <h3 class="quote-h">Rever a proposta</h3>
      ${missing.length ? `<div class="alert alert--warn" style="margin:0 0 14px;"><i class='bx bx-error'></i><span>Pode guardar o rascunho, mas para emitir falta: ${missing.join(' ')}</span></div>` : ''}
      <dl class="dl">
        <dt>Cliente</dt><dd>${esc(s.customer.company || s.customer.name || '—')}</dd>
        <dt>Contacto</dt><dd>${esc([s.customer.email, s.customer.phone].filter(Boolean).join(' · ') || '—')}</dd>
        <dt>Destino</dt><dd>${esc(s.trip.destination || '—')}</dd>
        <dt>Idioma</dt><dd>${s.locale === 'en' ? 'English' : 'Português'}</dd>
        <dt>Válida até</dt><dd>${esc(s.valid_until)}</dd>
      </dl>
      <ul class="lines" style="margin-top:12px;">${s.items.map((i, n) => `<li><span>${esc(i.description || '(sem nome)')}</span><span class="mono">${money(t.lines[n], s.currency)}</span></li>`).join('')}</ul>
      <p class="muted small" style="margin:14px 0 0;">Depois de emitida, a cotação fica fechada: qualquer alteração cria uma nova versão e a anterior é guardada.</p>`;
  };

  /* ── Rendering ─────────────────────────────────────────────────────────── */
  function summary() {
    const t = totals(s);
    $('#summary', main).innerHTML = `
      <ul class="lines">
        <li><span>Subtotal</span><span class="mono">${money(t.subtotal, s.currency)}</span></li>
        ${t.discount ? `<li class="is-discount"><span>Descontos</span><span class="mono">− ${money(t.discount, s.currency)}</span></li>` : ''}
        ${t.fees ? `<li><span>Taxas</span><span class="mono">${money(t.fees, s.currency)}</span></li>` : ''}
        <li class="is-total"><span>Total</span><span class="mono">${money(t.total, s.currency)}</span></li>
      </ul>
      ${s.deposit_percent ? `<p class="muted small" style="margin:8px 0 0;">Depósito de ${Number(s.deposit_percent)}%: ${money(Math.round(t.total * s.deposit_percent) / 100, s.currency)}</p>` : ''}
      <div class="stack" style="margin-top:14px;">
        <button type="button" class="btn btn--primary btn--block" id="issue"><i class='bx bx-check-shield'></i>Emitir cotação</button>
        <button type="button" class="btn btn--ghost btn--block" id="preview"><i class='bx bx-show'></i>Pré-visualizar PDF</button>
        <button type="button" class="btn btn--ghost btn--block" id="save"><i class='bx bx-save'></i>Guardar rascunho</button>
      </div>`;
    $('#save', main).addEventListener('click', e => saveAndStay(e.currentTarget));
    $('#preview', main).addEventListener('click', preview);
    $('#issue', main).addEventListener('click', e => issue(e.currentTarget));
    $$('[data-i]', panel).forEach(row => { const el = $('[data-line-total]', row); if (el) el.textContent = money(t.lines[Number(row.dataset.i)], s.currency); });
  }

  function show(n) {
    step = n;
    panel.innerHTML = [stepCustomer, stepTrip, stepServices, stepTerms, stepReview][step]();
    $$('#steps li', main).forEach((li, i) => { li.classList.toggle('is-current', i === step); li.classList.toggle('is-done', i < step); });
    $('#prev', main).hidden = step === 0;
    $('#next', main).hidden = step === STEPS.length - 1;
    wire();
    summary();
  }

  /* ── Editing ───────────────────────────────────────────────────────────── */
  $('#qf', main).addEventListener('submit', e => e.preventDefault());
  $('#qf', main).addEventListener('input', e => {
    const el = e.target;
    const row = el.closest('[data-i]');
    if (row && el.dataset.f) {
      const it = s.items[Number(row.dataset.i)], f = el.dataset.f;
      if (f === 'discount_value' || f === 'discount_kind') {
        const r = el.closest('[data-i]');
        const value = $('[data-f=discount_value]', r).value;
        it.discount = value === '' ? null : { kind: $('[data-f=discount_kind]', r).value, value: Number(value) };
      } else if (['quantity', 'participants', 'unit_price'].includes(f)) {
        it[f] = el.value === '' ? null : Number(el.value);
        if (f === 'unit_price') el.classList.toggle('is-invalid', el.value === '');
      } else it[f] = el.value;
    } else if (el.closest('[data-fee]')) {
      s.fees[Number(el.closest('[data-fee]').dataset.fee)][el.dataset.k] = el.dataset.k === 'amount' ? (el.value === '' ? null : Number(el.value)) : el.value;
    } else if (el.closest('[data-stop]')) {
      s.itinerary[Number(el.closest('[data-stop]').dataset.stop)][el.dataset.k] = el.value;
    } else if (el.id === 'gdisc' || el.id === 'gdisc-kind') {
      const value = $('#gdisc', panel).value;
      s.discount = value === '' ? null : { kind: $('#gdisc-kind', panel).value, value: Number(value) };
    } else if (el.name) {
      setPath(s, el.name, el.dataset.num !== undefined ? (el.value === '' ? null : Number(el.value)) : el.value);
      if (el.name === 'trip.date_from' || el.name === 'trip.date_to') {
        const { date_from: a, date_to: b } = s.trip;
        if (a && b && b >= a) {
          const n = Math.round((new Date(b) - new Date(a)) / 864e5);
          s.trip.nights = n; s.trip.days = n + 1;
          $('[name="trip.nights"]', panel).value = n;
          $('[name="trip.days"]', panel).value = n + 1;
        }
      }
      if (el.name === 'currency') { show(step); return; }
    }
    summary();
  });
  $('#qf', main).addEventListener('change', e => { if (e.target.dataset.f === 'discount_kind' || e.target.id === 'gdisc-kind') e.target.dispatchEvent(new Event('input', { bubbles: true })); });

  function fillContact(c) {
    s.customer = { ...s.customer, name: c.name || '', company: c.company || '', email: c.email || '', phone: c.phone || '', country: c.country || '',
      client_type: c.client_type || 'individual', nuit: c.nuit || '', address: c.address || '' };
    show(step);
    toast('Dados do cliente preenchidos.');
  }

  function wire() {
    const search = $('#csearch', panel);
    if (search) search.addEventListener('input', debounce(async () => {
      const box = $('#cresults', panel);
      const q = search.value.trim();
      if (q.length < 2) { box.hidden = true; return; }
      try {
        const { items } = await get(`/admin/contacts?q=${encodeURIComponent(q)}`);
        box.hidden = false;
        box.innerHTML = items.length ? items.map((c, i) => `<button type="button" data-c="${i}"><strong>${esc(c.company || c.name)}</strong>
            <span class="muted small">${esc([c.company ? c.name : null, c.email, c.phone].filter(Boolean).join(' · '))}${c.source === 'account' ? ' · tem conta' : ''}</span></button>`).join('')
          : '<p class="muted small" style="margin:8px;">Sem resultados. Preencha os dados abaixo para criar um contacto novo.</p>';
        $$('[data-c]', box).forEach(b => b.addEventListener('click', () => fillContact(items[Number(b.dataset.c)])));
      } catch (err) { toast(errorText(err), 'error'); }
    }));
    $('#add-custom', panel)?.addEventListener('click', () => { s.items.push(blankItem()); show(step); $$('[data-f=description]', panel).pop().focus(); });
    $('#add-cat', panel)?.addEventListener('click', addFromCatalogue);
    $$('[data-remove]', panel).forEach(b => b.addEventListener('click', () => { s.items.splice(Number(b.dataset.remove), 1); show(step); }));
    $('#add-fee', panel)?.addEventListener('click', () => { s.fees.push({ label: '', amount: null }); show(step); });
    $$('[data-remove-fee]', panel).forEach(b => b.addEventListener('click', () => { s.fees.splice(Number(b.dataset.removeFee), 1); show(step); }));
    $('#add-stop', panel)?.addEventListener('click', () => { s.itinerary.push({ title: '', description: '' }); show(step); });
    $$('[data-remove-stop]', panel).forEach(b => b.addEventListener('click', () => { s.itinerary.splice(Number(b.dataset.removeStop), 1); show(step); }));
  }

  /** Add a package or private service; the price is the current one and stays editable. */
  async function addFromCatalogue() {
    const packs = builder.packages;
    const en = s.locale === 'en';
    const group = (title, list) => `<optgroup label="${title}">${list.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</optgroup>`;
    let added = null;
    const r = await modal({
      title: 'Adicionar do catálogo', wide: true,
      body: `<div class="grid grid--2">
          <label class="field span-all"><span>Serviço</span><select name="pick"><option value="">Escolher…</option>
            ${group('Passeios e excursões', packs.filter(p => p.kind === 'tour'))}${group('Alojamento', packs.filter(p => p.kind === 'accommodation'))}
            <optgroup label="Serviços privados">${builder.services.map(x => `<option value="service:${x.key}">${esc(x.title)}</option>`).join('')}</optgroup></select></label>
          <label class="field" id="m-opt" hidden><span>Opção</span><select name="option_key"></select></label>
          <label class="field"><span>Data</span><input type="date" name="date" value="${esc(s.trip.date_from || '')}"></label>
          <label class="field" id="m-nights" hidden><span>Noites</span><input type="number" name="nights" min="1" max="365" value="${s.trip.nights || 1}"></label>
          <label class="field"><span>Adultos</span><input type="number" name="adults" min="0" max="1000" value="${s.trip.adults ?? 2}"></label>
          <label class="field"><span>Crianças</span><input type="number" name="children" min="0" max="1000" value="${s.trip.children ?? 0}"></label>
          <label class="check span-all"><input type="checkbox" name="copy" checked> Copiar incluído, não incluído e itinerário do pacote</label>
        </div>`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Adicionar', kind: 'primary', value: 'ok', submit: true,
        validate: v => (!v.pick ? 'Escolha um serviço.' : null),
        run: async v => {
          if (v.pick.startsWith('service:')) {
            const x = builder.services.find(y => y.key === v.pick.slice(8));
            added = { item: { ...blankItem(), kind: 'service', service_key: x.key, description: en ? x.title_en : x.title, date_from: v.date } };
            return;
          }
          const p = packs.find(y => y.id === v.pick);
          const opt = p.options.find(o => o.key === v.option_key);
          let price = null;
          if (v.date) {
            try { price = await post('/admin/quotations/price', { package_id: p.id, date: v.date, nights: p.kind === 'accommodation' ? v.nights : null, adults: v.adults ?? 0, children: v.children ?? 0, option_key: v.option_key || null }); }
            catch (err) { toast(`Preço por preencher: ${errorText(err)}`, 'error'); }
          }
          const name = en ? p.title_en : p.title;
          const optName = opt ? ` — ${en ? opt.name_en : opt.name}` : '';
          added = { pkg: p, copy: v.copy, price, item: { ...blankItem(), kind: 'package', package_id: p.id, option_key: v.option_key || null, description: name + optName, date_from: v.date,
            date_to: p.kind === 'accommodation' && price ? price.end_date : '', nights: p.kind === 'accommodation' ? v.nights : null, adults: v.adults ?? 0, children: v.children ?? 0,
            participants: (v.adults ?? 0) + (v.children ?? 0), unit_price: price ? price.total : null } };
        } }],
      onOpen: dlg => {
        const pick = $('[name=pick]', dlg);
        pick.addEventListener('change', () => {
          const p = packs.find(y => y.id === pick.value);
          $('#m-nights', dlg).hidden = !p || p.kind !== 'accommodation';
          const has = !!(p && p.options.length);
          $('#m-opt', dlg).hidden = !has;
          $('[name=option_key]', dlg).innerHTML = has ? p.options.map(o => `<option value="${esc(o.key)}">${esc(o.name)}</option>`).join('') : '';
        });
      },
    });
    if (!r || !added) return;
    const { item, pkg, copy, price } = added;
    if (price && price.currency !== s.currency) {
      if (s.items.length) { item.unit_price = null; toast(`O preço deste serviço está em ${price.currency}. Indique o valor em ${s.currency}: não há conversão automática.`, 'error'); }
      else s.currency = price.currency;
    }
    s.items.push(item);
    if (pkg && copy) {
      const list = k => (en ? pkg[`${k}_en`].length ? pkg[`${k}_en`] : pkg[k] : pkg[k]);
      const append = (cur, lines) => [cur, ...lines.filter(l => !(cur || '').includes(l))].filter(Boolean).join('\n');
      s.inclusions = append(s.inclusions, list('included'));
      s.exclusions = append(s.exclusions, list('excluded'));
      for (const t of pkg.itinerary) s.itinerary.push({ title: (en && t.title_en) || t.title, description: (en && t.description_en) || t.description });
    }
    show(step);
  }

  /* ── Saving ────────────────────────────────────────────────────────────── */
  const body = () => ({
    ...s,
    customer: { ...s.customer, email: (s.customer.email || '').trim() },
    trip: { ...s.trip, date_from: s.trip.date_from || null, date_to: s.trip.date_to || null },
    items: s.items.filter(i => i.description).map(i => ({ ...i, date_from: i.date_from || null, date_to: i.date_to || null, quantity: i.quantity || 1 })),
    fees: s.fees.filter(f => f.label),
  });
  async function save() {
    if (quoteId) await patch(`/admin/quotations/${quoteId}`, body());
    else {
      const r = await post('/admin/quotations', body());
      quoteId = r.id;
      setTitle(r.number);
      history.replaceState(null, '', `#/quotations/${r.id}/edit`);
    }
  }
  const saveAndStay = btn => busy(btn, save, 'Rascunho guardado.').catch(() => {});
  async function preview() {
    const win = window.open('', '_blank');
    try {
      await save();
      win.location = `/api/admin/quotations/${quoteId}/pdf?inline=1`;
    } catch (err) { win.close(); toast(errorText(err), 'error'); }
  }
  async function issue(btn) {
    try {
      await busy(btn, async () => { await save(); await post(`/admin/quotations/${quoteId}/issue`); }, 'Cotação emitida.');
      location.hash = `#/quotations/${quoteId}`;
    } catch { /* toast */ }
  }

  $('#prev', main).addEventListener('click', () => show(step - 1));
  $('#next', main).addEventListener('click', () => show(step + 1));
  $$('#steps li', main).forEach(li => {
    li.addEventListener('click', () => show(Number(li.dataset.step)));
    li.addEventListener('keydown', e => { if (e.key === 'Enter') show(Number(li.dataset.step)); });
  });
  show(step);
}
