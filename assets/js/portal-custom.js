/**
 * portal-custom.js
 * Quote request: choose packages/services → dates & group → preferences →
 * contact → summary → submit → reference. A request is never a booking: the
 * team replies with a quotation (in the account and/or by e-mail/WhatsApp).
 *
 * @copyright  2026 Maputo Blue. All rights reserved.
 * @author     Wilson Creative Studio
 * @license    Proprietary — Unauthorised use or distribution is prohibited.
 */
(function () {
  'use strict';

  const API = window.MBApi;
  const root = document.getElementById('portal-root');
  if (!API || !root) return;
  const { LANG, ROOT, esc, money } = API;
  const EN = LANG === 'en';

  const CAT_LABELS = {
    'island-daytrips': EN ? 'Island trips' : 'Passeios às ilhas', 'beach-daytrips': EN ? 'Beach & sunset' : 'Praia e pôr do sol',
    safaris: 'Safari', 'whale-watching': EN ? 'Whale watching' : 'Observação de baleias',
    'fishing-charters': EN ? 'Deep-sea fishing' : 'Pesca de alto mar', 'maputo-city-tour': EN ? 'City tour' : 'Passeio por Maputo',
    transfers: 'Transfers', accommodation: EN ? 'Accommodation' : 'Alojamento', services: EN ? 'Private services' : 'Serviços privados',
  };
  // Private services outside the bookable catalogue (same keys as the server)
  const SERVICES = [
    { key: 'boat-charter', title: EN ? 'Private boat charter' : 'Aluguer de barco privado', img: 'assets/images/hero/hero-8.webp',
      sub: EN ? 'Your own boat and skipper' : 'Barco e skipper só para o seu grupo' },
    { key: 'tour-car', title: EN ? 'Touring & safari car' : 'Carro de turismo e safari', img: 'assets/images/private-charter/car/car-2.webp',
      sub: EN ? 'Private car with driver' : 'Carro privado com motorista' },
    { key: 'airport-transfer', title: EN ? 'Airport transfer' : 'Transfer do aeroporto', img: 'assets/images/transfers/car/car-transfer-1.webp',
      sub: EN ? 'Pick-up and drop-off' : 'Recolha e entrega' },
  ];

  const T = EN ? {
    steps: ['Experiences', 'Dates & group', 'Preferences', 'Contact'],
    pickTitle: 'What would you like in your quotation?', pickHint: 'Choose one or more experiences, stays or services. You can also just describe your idea below.',
    search: 'Search experiences…', all: 'All', selected: n => `${n} selected`, add: 'Add', added: 'Added', from: 'from', perNight: '/ night',
    other: 'Other ideas or destinations (optional)', otherHint: 'e.g. 3 days in Inhaca, honeymoon, company event…',
    pickRequired: 'Choose at least one experience or service, or describe your idea.',
    tripFrom: 'Trip start', tripTo: 'Trip end', flexible: 'My dates are flexible', perItem: 'Preferred date for each item (optional)', sameDates: 'Any date within the trip',
    adults: 'Adults', children: 'Children (4–10)', accommodation: 'Accommodation preferences', accHint: 'e.g. beach lodge, 2 rooms',
    transport: 'Transport', transHint: 'e.g. airport pick-up, 4x4', budget: 'Estimated budget (optional)', currency: 'Currency',
    special: 'Special requests', name: 'Full name', email: 'E-mail', phone: 'Phone / WhatsApp',
    consent: 'I agree that Maputo Blue uses my details to prepare this quotation, as described in the', privacy: 'privacy policy',
    next: 'Continue', back: 'Back', review: 'Review your request', send: 'Request quotation', sending: 'Sending…',
    items: 'Experiences & services', dates: 'Dates', flexibleDates: 'flexible', none: '—', guests: 'Group', remove: 'Remove',
    done: 'Request sent!', doneAcct: 'Thank you! Our team will prepare your quotation. It will appear in your account and we will also contact you by e-mail or WhatsApp.',
    doneGuest: 'Thank you! Our team will prepare your quotation and send it by e-mail or WhatsApp. Nothing is booked or charged yet.',
    refLabel: 'Request reference', account: 'See it in your account', createAccount: 'Create an account to follow your quotation online',
    asCompany: 'Request on behalf of a company', asCompanyHint: 'the quotation will be addressed to the company', company: 'Company name', companyAddress: 'Billing address', nuitInvalid: 'The NUIT has 9 digits.',
    required: 'Please fill in the required fields.', dateOrder: 'The end date must be after the start date.', datePast: 'Please choose a future date.',
  } : {
    steps: ['Experiências', 'Datas e grupo', 'Preferências', 'Contacto'],
    pickTitle: 'O que gostaria de incluir na cotação?', pickHint: 'Escolha uma ou mais experiências, alojamentos ou serviços. Também pode apenas descrever a sua ideia abaixo.',
    search: 'Pesquisar experiências…', all: 'Todos', selected: n => `${n} seleccionado(s)`, add: 'Adicionar', added: 'Adicionado', from: 'desde', perNight: '/ noite',
    other: 'Outras ideias ou destinos (opcional)', otherHint: 'ex.: 3 dias na Inhaca, lua de mel, evento de empresa…',
    pickRequired: 'Escolha pelo menos uma experiência ou serviço, ou descreva a sua ideia.',
    tripFrom: 'Início da viagem', tripTo: 'Fim da viagem', flexible: 'As minhas datas são flexíveis', perItem: 'Data preferida para cada item (opcional)', sameDates: 'Qualquer data dentro da viagem',
    adults: 'Adultos', children: 'Crianças (4–10)', accommodation: 'Preferências de alojamento', accHint: 'ex.: lodge de praia, 2 quartos',
    transport: 'Transporte', transHint: 'ex.: recolha no aeroporto, 4x4', budget: 'Orçamento estimado (opcional)', currency: 'Moeda',
    special: 'Pedidos especiais', name: 'Nome completo', email: 'E-mail', phone: 'Telefone / WhatsApp',
    consent: 'Aceito que a Maputo Blue use os meus dados para preparar esta cotação, conforme a', privacy: 'política de privacidade',
    next: 'Continuar', back: 'Voltar', review: 'Rever o pedido', send: 'Pedir cotação', sending: 'A enviar…',
    items: 'Experiências e serviços', dates: 'Datas', flexibleDates: 'flexíveis', none: '—', guests: 'Grupo', remove: 'Remover',
    done: 'Pedido enviado!', doneAcct: 'Obrigado! A nossa equipa vai preparar a sua cotação. Vai aparecer na sua conta e também entraremos em contacto por e-mail ou WhatsApp.',
    doneGuest: 'Obrigado! A nossa equipa vai preparar a sua cotação e enviá-la por e-mail ou WhatsApp. Nada foi reservado nem cobrado.',
    refLabel: 'Referência do pedido', account: 'Ver na minha conta', createAccount: 'Crie uma conta para acompanhar a cotação online',
    asCompany: 'Pedido em nome de uma empresa', asCompanyHint: 'a cotação é emitida em nome da empresa', company: 'Nome da empresa', companyAddress: 'Morada de facturação', nuitInvalid: 'O NUIT tem 9 dígitos.',
    required: 'Preencha os campos obrigatórios.', dateOrder: 'A data final deve ser posterior à data inicial.', datePast: 'Escolha uma data futura.',
  };

  const data = { items: [], adults: 2, children: 0, budget_currency: 'MZN', flexible_dates: false };
  let catalog = [];          // [{key, kind, package_id|service_key, title, sub, img, category, price, currency, per_night}]
  let filter = { cat: 'all', q: '' };
  let user = null;
  let step = 0;
  let idem = API.idempotencyKey();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Maputo' }).format(new Date());
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const isSel = key => data.items.some(i => i.key === key);
  const byKey = key => catalog.find(c => c.key === key);

  const stepper = () => `<div class="mb-steps" aria-label="Progress">${T.steps.map((s, i) =>
    `<span class="mb-step${i <= step ? ' is-active' : ''}"${i === step ? ' aria-current="step"' : ''}><b>${i + 1}</b>${s}</span>`).join('')}</div>`;

  /* ── Step 1: catalogue picker ─────────────────────────────── */
  function pickerCards() {
    const q = norm(filter.q.trim());
    const list = catalog.filter(c => (filter.cat === 'all' || c.category === filter.cat) && (!q || norm(`${c.title} ${c.sub}`).includes(q)));
    if (!list.length) return `<p class="qp-empty">${esc(EN ? 'No matches.' : 'Sem resultados.')}</p>`;
    return list.map(c => {
      const on = isSel(c.key);
      return `<button type="button" class="qp-card${on ? ' is-on' : ''}" data-key="${esc(c.key)}" aria-pressed="${on}">
        <span class="qp-card__img">${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy" decoding="async">` : ''}<span class="qp-card__tick" aria-hidden="true"><i class='bx bx-check'></i></span></span>
        <span class="qp-card__body"><span class="qp-card__cat">${esc(CAT_LABELS[c.category] || c.category)}</span>
          <strong>${esc(c.title)}</strong><small>${esc(c.sub || '')}</small>
          ${c.price ? `<span class="qp-card__price">${T.from} ${money(c.price, c.currency)}${c.per_night ? ` ${T.perNight}` : ''}</span>` : ''}</span>
        <span class="qp-card__cta">${on ? `<i class='bx bx-check'></i>${T.added}` : `<i class='bx bx-plus'></i>${T.add}`}</span>
      </button>`;
    }).join('');
  }
  function pickerStep() {
    const cats = ['all', ...new Set(catalog.map(c => c.category))];
    return `
      <div class="mb-field--full qp">
        <h2 class="qp__title">${T.pickTitle}</h2>
        <p class="qp__hint">${T.pickHint}</p>
        <div class="qp__bar">
          <label class="qp__search"><i class='bx bx-search' aria-hidden="true"></i><span class="visually-hidden">${T.search}</span>
            <input type="search" name="qp_q" placeholder="${T.search}" value="${esc(filter.q)}" autocomplete="off"></label>
          <span class="qp__count" aria-live="polite">${T.selected(data.items.length)}</span>
        </div>
        <div class="qp__cats" role="group">${cats.map(k => `<button type="button" class="qp__cat${filter.cat === k ? ' is-on' : ''}" data-cat="${k}" aria-pressed="${filter.cat === k}">${esc(k === 'all' ? T.all : CAT_LABELS[k] || k)}</button>`).join('')}</div>
        <div class="qp__grid">${pickerCards()}</div>
      </div>
      <label class="mb-field mb-field--full"><span>${T.other}</span><textarea class="booking-input" name="activities" rows="3" maxlength="1000" placeholder="${T.otherHint}">${esc(data.activities || '')}</textarea></label>`;
  }
  function wirePicker(form) {
    const grid = form.querySelector('.qp__grid');
    const refresh = () => { grid.innerHTML = pickerCards(); form.querySelector('.qp__count').textContent = T.selected(data.items.length); };
    grid.addEventListener('click', e => {
      const card = e.target.closest('.qp-card');
      if (!card) return;
      const key = card.dataset.key;
      if (isSel(key)) data.items = data.items.filter(i => i.key !== key);
      else data.items.push({ key, date: '' });
      refresh();
      const again = grid.querySelector(`.qp-card[data-key="${CSS.escape(key)}"]`);
      if (again) again.focus();
    });
    form.querySelectorAll('.qp__cat').forEach(b => b.addEventListener('click', () => {
      filter.cat = b.dataset.cat;
      form.querySelectorAll('.qp__cat').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      refresh();
    }));
    let t;
    form.querySelector('[name=qp_q]').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { filter.q = e.target.value; refresh(); }, 150); });
  }

  /* ── Steps 2–4 ────────────────────────────────────────────── */
  const fields = [
    pickerStep,
    () => `
      <label class="mb-field"><span>${T.tripFrom}</span><input class="booking-input" type="date" name="date_from" min="${today}" value="${esc(data.date_from || '')}"></label>
      <label class="mb-field"><span>${T.tripTo}</span><input class="booking-input" type="date" name="date_to" min="${today}" value="${esc(data.date_to || '')}"></label>
      <label class="booking-check mb-field--full"><input type="checkbox" name="flexible_dates"${data.flexible_dates ? ' checked' : ''}><span>${T.flexible}</span></label>
      <label class="mb-field"><span>${T.adults} *</span><input class="booking-input" type="number" name="adults" min="1" max="200" required value="${data.adults}"></label>
      <label class="mb-field"><span>${T.children}</span><input class="booking-input" type="number" name="children" min="0" max="200" value="${data.children}"></label>
      ${data.items.length ? `<div class="mb-field mb-field--full"><span>${T.perItem}</span>
        <ul class="qp-dates">${data.items.map(i => { const c = byKey(i.key) || { title: i.key }; return `
          <li><span class="qp-dates__name">${esc(c.title)}</span>
            <input class="booking-input" type="date" min="${today}" data-item-date="${esc(i.key)}" value="${esc(i.date || '')}" aria-label="${esc(c.title)}" title="${esc(T.sameDates)}"></li>`; }).join('')}</ul></div>` : ''}`,
    () => `
      <label class="mb-field mb-field--full"><span>${T.accommodation}</span><input class="booking-input" name="accommodation" maxlength="500" placeholder="${T.accHint}" value="${esc(data.accommodation || '')}"></label>
      <label class="mb-field mb-field--full"><span>${T.transport}</span><input class="booking-input" name="transport" maxlength="500" placeholder="${T.transHint}" value="${esc(data.transport || '')}"></label>
      <label class="mb-field"><span>${T.budget}</span><input class="booking-input" type="number" name="budget" min="0" step="100" value="${data.budget ?? ''}"></label>
      <label class="mb-field"><span>${T.currency}</span><select class="booking-input" name="budget_currency">${['MZN', 'USD', 'ZAR', 'EUR'].map(c => `<option${data.budget_currency === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="mb-field mb-field--full"><span>${T.special}</span><textarea class="booking-input" name="special_requests" rows="3" maxlength="2000">${esc(data.special_requests || '')}</textarea></label>`,
    () => `
      <label class="mb-field mb-field--full"><span>${T.name} *</span><input class="booking-input" name="name" required maxlength="120" autocomplete="name" value="${esc(data.name || '')}"></label>
      <label class="mb-field"><span>${T.email} *</span><input class="booking-input" type="email" name="email" required autocomplete="email" value="${esc(data.email || '')}"></label>
      <label class="mb-field"><span>${T.phone} *</span><input class="booking-input" type="tel" name="phone" required maxlength="30" pattern="[\\d\\s+\\-\\(\\)]{6,30}" autocomplete="tel" value="${esc(data.phone || '')}"></label>
      <label class="booking-check mb-field--full qp-company-toggle"><input type="checkbox" name="as_company"${data.as_company ? ' checked' : ''}><span><strong>${T.asCompany}</strong> — ${T.asCompanyHint}</span></label>
      <div class="mb-field--full qp-company" ${data.as_company ? '' : 'hidden'}>
        <div class="mb-form-grid">
          <label class="mb-field mb-field--full"><span>${T.company} *</span><input class="booking-input" name="company_name" maxlength="160" autocomplete="organization" value="${esc((data.billing && data.billing.company_name) || '')}"${data.as_company ? ' required' : ''}></label>
          <label class="mb-field"><span>NUIT</span><input class="booking-input" name="nuit" inputmode="numeric" maxlength="11" pattern="\\d{3}\\s?\\d{3}\\s?\\d{3}" placeholder="000 000 000" value="${esc((data.billing && data.billing.nuit) || '')}"></label>
          <label class="mb-field"><span>${T.companyAddress}</span><input class="booking-input" name="company_address" maxlength="300" autocomplete="street-address" value="${esc((data.billing && data.billing.address) || '')}"></label>
        </div>
      </div>`,
  ];

  function collect(form) {
    const fd = new FormData(form);
    if (step === 0) { data.activities = (fd.get('activities') || '').trim(); }
    if (step === 1) {
      data.date_from = fd.get('date_from') || ''; data.date_to = fd.get('date_to') || '';
      data.flexible_dates = !!fd.get('flexible_dates'); data.adults = parseInt(fd.get('adults'), 10) || 0; data.children = parseInt(fd.get('children'), 10) || 0;
      form.querySelectorAll('[data-item-date]').forEach(inp => { const it = data.items.find(i => i.key === inp.dataset.itemDate); if (it) it.date = inp.value; });
    }
    if (step === 2) {
      data.accommodation = fd.get('accommodation').trim(); data.transport = fd.get('transport').trim();
      data.budget = fd.get('budget') === '' ? null : Number(fd.get('budget')); data.budget_currency = fd.get('budget_currency'); data.special_requests = fd.get('special_requests').trim();
    }
    if (step === 3) {
      data.name = fd.get('name').trim(); data.email = fd.get('email').trim(); data.phone = fd.get('phone').trim();
      data.as_company = !!fd.get('as_company');
      data.billing = data.as_company ? { company_name: (fd.get('company_name') || '').trim(), nuit: (fd.get('nuit') || '').replace(/\s+/g, ''), address: (fd.get('company_address') || '').trim() } : null;
    }
  }

  function validate(form) {
    if (step === 0 && !data.items.length && !data.activities) return T.pickRequired;
    const bad = [...form.querySelectorAll('input[required], input[pattern], input[type=email], input[type=number], input[type=date]')].filter(i => !i.checkValidity());
    form.querySelectorAll('.is-invalid').forEach(i => i.classList.remove('is-invalid'));
    bad.forEach(i => i.classList.add('is-invalid'));
    if (bad.length) { bad[0].focus(); return T.required; }
    if (step === 3 && data.billing && data.billing.nuit && !/^\d{9}$/.test(data.billing.nuit)) return T.nuitInvalid;
    if (step === 1) {
      if ((data.date_from && data.date_from < today) || data.items.some(i => i.date && i.date < today)) return T.datePast;
      if (data.date_from && data.date_to && data.date_to < data.date_from) return T.dateOrder;
    }
    return null;
  }

  function render(msg = '') {
    if (step === 4) return summary(msg);
    root.innerHTML = `
      <div class="mb-panel" style="max-width:${step === 0 ? 1080 : 760}px;margin-inline:auto;">
        ${stepper()}
        <form novalidate>
          <div class="mb-form-grid">${fields[step]()}</div>
          <div class="mb-form-msg">${msg}</div>
          <div class="mb-form-actions">
            ${step > 0 ? `<button type="button" class="btn-outline-mb" data-back>${T.back}</button>` : ''}
            <button type="submit" class="btn-primary-mb">${step === 3 ? T.review : T.next}<i class='bx bx-right-arrow-alt'></i></button>
          </div>
        </form>
      </div>`;
    const form = root.querySelector('form');
    if (step === 0) wirePicker(form);
    const back = root.querySelector('[data-back]');
    if (back) back.addEventListener('click', () => { collect(form); step--; render(); });
    form.addEventListener('submit', e => {
      e.preventDefault();
      collect(form);
      const problem = validate(form);
      if (problem) { form.querySelector('.mb-form-msg').innerHTML = `<p class="mb-alert" role="alert">${problem}</p>`; return; }
      step++;
      render();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // Company fields appear (and become required) only for requests on behalf of a company
    const toggle = form.querySelector('[name=as_company]');
    if (toggle) toggle.addEventListener('change', () => {
      form.querySelector('.qp-company').hidden = !toggle.checked;
      form.querySelector('[name=company_name]').required = toggle.checked;
      if (toggle.checked) form.querySelector('[name=company_name]').focus();
    });
    const first = form.querySelector('input:not([type=checkbox]):not([name=qp_q]), textarea');
    if (first && step > 0) first.focus();
  }

  function summary(msg) {
    const dates = data.date_from ? `${API.date(data.date_from)}${data.date_to ? ` → ${API.date(data.date_to)}` : ''}` : T.none;
    const rows = [
      [T.dates, dates + (data.flexible_dates ? ` (${T.flexibleDates})` : '')],
      [T.guests, `${data.adults} ${T.adults.toLowerCase()}${data.children ? `, ${data.children} ${T.children.toLowerCase()}` : ''}`],
      [T.other, data.activities || T.none], [T.accommodation, data.accommodation || T.none], [T.transport, data.transport || T.none],
      [T.budget, data.budget ? `${data.budget_currency} ${Number(data.budget).toLocaleString('en-US')}` : T.none],
      [T.special, data.special_requests || T.none], [T.name, data.name], [T.email, data.email], [T.phone, data.phone],
      ...(data.billing ? [[T.company, data.billing.company_name], ['NUIT', data.billing.nuit || T.none], [T.companyAddress, data.billing.address || T.none]] : []),
    ];
    root.innerHTML = `
      <div class="mb-panel" style="max-width:760px;margin-inline:auto;">
        <h2>${T.review}</h2>
        ${data.items.length ? `<h3 class="qp-sum__title">${T.items}</h3><ul class="qp-sum">${data.items.map(i => { const c = byKey(i.key) || { title: i.key }; return `
          <li>${c.img ? `<img src="${esc(c.img)}" alt="">` : ''}<span><strong>${esc(c.title)}</strong><small>${i.date ? esc(API.date(i.date)) : esc(T.sameDates)}</small></span></li>`; }).join('')}</ul>` : ''}
        <dl class="mb-detail">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        <form novalidate>
          <div class="mb-hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
          <label class="booking-check booking-check--consent"><input type="checkbox" name="consent" required>
            <span>${T.consent} <a href="${ROOT}${EN ? 'en' : 'pages'}/privacy.html" target="_blank" rel="noopener">${T.privacy}</a>. *</span></label>
          <div class="mb-form-msg">${msg}</div>
          <div class="mb-form-actions">
            <button type="button" class="btn-outline-mb" data-back>${T.back}</button>
            <button type="submit" class="btn-primary-mb"><i class='bx bx-send'></i>${T.send}</button>
          </div>
        </form>
      </div>`;
    const form = root.querySelector('form');
    root.querySelector('[data-back]').addEventListener('click', () => { step = 3; render(); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.consent.checked) {
        form.consent.closest('label').classList.add('is-invalid');
        form.querySelector('.mb-form-msg').innerHTML = `<p class="mb-alert" role="alert">${esc(API.errorText(new API.ApiError(400, 'consent_required')))}</p>`;
        return;
      }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i>${T.sending}`;
      const body = {
        name: data.name, email: data.email, phone: data.phone, locale: LANG, adults: data.adults, children: data.children,
        flexible_dates: data.flexible_dates, date_from: data.date_from || undefined, date_to: data.date_to || undefined,
        items: data.items.map(i => { const c = byKey(i.key) || {}; return { ...(c.package_id ? { package_id: c.package_id } : { service_key: c.service_key || i.key }), ...(i.date ? { date: i.date } : {}) }; }),
        accommodation: data.accommodation || undefined, transport: data.transport || undefined, activities: data.activities || undefined,
        budget: data.budget ?? undefined, budget_currency: data.budget ? data.budget_currency : undefined,
        special_requests: data.special_requests || undefined, consent: true, idempotency_key: idem, website: form.website.value,
        billing: data.billing ? { company_name: data.billing.company_name, nuit: data.billing.nuit || undefined, address: data.billing.address || undefined } : undefined,
      };
      try {
        const r = await API.post('/custom-requests', body);
        idem = API.idempotencyKey();
        const acct = `${ROOT}${EN ? 'en' : 'pages'}/account.html`;
        root.innerHTML = `
          <div class="mb-panel mb-panel--narrow" style="text-align:center;">
            <div class="mb-success-icon"><i class='bx bx-check'></i></div>
            <h2>${T.done}</h2>
            <p class="mb-ref-label">${T.refLabel}</p><p class="mb-ref">${esc(r.request.reference)}</p>
            <p>${user ? T.doneAcct : T.doneGuest}</p>
            <p style="margin-top:14px;"><a class="mb-link" href="${user ? `${acct}#requests` : `${acct}?tab=register`}">${user ? T.account : T.createAccount}</a></p>
          </div>`;
      } catch (err) {
        summary(`<p class="mb-alert" role="alert">${esc(API.errorText(err))}</p>`);
      }
    });
  }

  async function loadCatalog() {
    const [tours, accs] = await Promise.all([API.get('/catalog/tours').catch(() => []), API.get('/catalog/accommodations').catch(() => [])]);
    const imgOf = p => { const src = p.cover || (p.images && p.images[0]) || ''; return src ? ROOT + String(src).replace(/^(\.\.\/)+/, '') : ''; };
    catalog = [
      ...tours.map(p => ({ key: p.id, kind: 'package', package_id: p.id, category: p.category, title: (EN && p.title_en) || p.title,
        sub: (EN && p.location_en) || p.location || '', img: imgOf(p), price: p.price_from, currency: p.currency })),
      ...accs.map(p => ({ key: p.id, kind: 'package', package_id: p.id, category: 'accommodation', title: (EN && p.name_en) || p.name || p.title,
        sub: (EN && p.location_en) || p.location || '', img: imgOf(p), price: p.price_per_night, currency: p.currency, per_night: true })),
      ...SERVICES.map(s => ({ key: `svc:${s.key}`, kind: 'service', service_key: s.key, category: 'services', title: s.title, sub: s.sub, img: ROOT + s.img })),
    ];
  }

  (async function start() {
    if (!(await API.available())) {
      root.innerHTML = `<p class="mb-alert" role="alert">${esc(API.errorText(new API.ApiError(0, 'network')))}</p>`;
      return;
    }
    root.innerHTML = '<div class="mb-panel"><div class="mb-skeleton-line"></div><div class="mb-skeleton-line" style="width:70%"></div></div>';
    try {
      user = (await API.get('/auth/me')).user;
      if (user) Object.assign(data, { name: user.name, email: user.email, phone: user.phone || '' });
    } catch (_) { /* guest */ }
    await loadCatalog();
    // Pre-select from a link, e.g. custom-tour.html?package=sunset-cruise-maputo-bay
    const pre = new URLSearchParams(location.search).get('package');
    if (pre && byKey(pre)) data.items.push({ key: pre, date: '' });
    render();
  })();
})();
