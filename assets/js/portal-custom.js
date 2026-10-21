/**
 * portal-custom.js
 * Custom tour request: 4 short steps → summary → submit → reference.
 * A request is never a booking: the team replies with a quotation.
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
  const { LANG, ROOT, esc } = API;
  const EN = LANG === 'en';

  const CATS = [
    ['island-daytrips', EN ? 'Island trips' : 'Passeios às ilhas'], ['beach-daytrips', EN ? 'Beach & sunset' : 'Praia e pôr do sol'],
    ['safaris', 'Safari'], ['whale-watching', EN ? 'Whale watching' : 'Observação de baleias'],
    ['fishing-charters', EN ? 'Deep-sea fishing' : 'Pesca de alto mar'], ['maputo-city-tour', EN ? 'Maputo city tour' : 'Passeio por Maputo'],
    ['transfers', 'Transfers'], ['accommodation', EN ? 'Accommodation' : 'Alojamento'],
  ];

  const T = EN ? {
    steps: ['Experience', 'Dates & group', 'Preferences', 'Contact'],
    destination: 'Where would you like to go?', destHint: 'e.g. Inhaca Island and Kruger Park', interests: 'What interests you?',
    activities: 'Activities you would like', from: 'From', to: 'To', flexible: 'My dates are flexible',
    adults: 'Adults', children: 'Children (4–10)', accommodation: 'Accommodation', accHint: 'e.g. beach lodge, 2 rooms',
    transport: 'Transport', transHint: 'e.g. airport pick-up, 4x4', budget: 'Estimated budget (optional)', currency: 'Currency',
    special: 'Special requests', name: 'Full name', email: 'E-mail', phone: 'Phone / WhatsApp',
    consent: 'I agree that Maputo Blue uses my details to prepare this quotation, as described in the', privacy: 'privacy policy',
    next: 'Continue', back: 'Back', review: 'Review your request', send: 'Send request', sending: 'Sending…',
    flexibleDates: 'Flexible dates', none: '—', guests: 'Group',
    done: 'Request sent!', doneText: 'Thank you! Our team will prepare a personalised quotation and reply by e-mail. A request is not a booking — nothing is reserved or charged yet.',
    refLabel: 'Request reference', account: 'Follow your request in your account', required: 'Please fill in the required fields.',
    dateOrder: 'The end date must be after the start date.', datePast: 'Please choose a future date.',
  } : {
    steps: ['Experiência', 'Datas e grupo', 'Preferências', 'Contacto'],
    destination: 'Para onde gostaria de ir?', destHint: 'ex.: Ilha de Inhaca e Parque Kruger', interests: 'O que lhe interessa?',
    activities: 'Actividades que gostaria de fazer', from: 'De', to: 'Até', flexible: 'As minhas datas são flexíveis',
    adults: 'Adultos', children: 'Crianças (4–10)', accommodation: 'Alojamento', accHint: 'ex.: lodge de praia, 2 quartos',
    transport: 'Transporte', transHint: 'ex.: recolha no aeroporto, 4x4', budget: 'Orçamento estimado (opcional)', currency: 'Moeda',
    special: 'Pedidos especiais', name: 'Nome completo', email: 'E-mail', phone: 'Telefone / WhatsApp',
    consent: 'Aceito que a Maputo Blue use os meus dados para preparar esta cotação, conforme a', privacy: 'política de privacidade',
    next: 'Continuar', back: 'Voltar', review: 'Reveja o seu pedido', send: 'Enviar pedido', sending: 'A enviar…',
    flexibleDates: 'Datas flexíveis', none: '—', guests: 'Grupo',
    done: 'Pedido enviado!', doneText: 'Obrigado! A nossa equipa vai preparar uma cotação personalizada e responder por e-mail. Um pedido não é uma reserva — nada foi reservado nem cobrado.',
    refLabel: 'Referência do pedido', account: 'Acompanhe o seu pedido na sua conta', required: 'Preencha os campos obrigatórios.',
    dateOrder: 'A data final deve ser posterior à data inicial.', datePast: 'Escolha uma data futura.',
  };

  const data = { categories: [], adults: 2, children: 0, budget_currency: 'MZN', flexible_dates: false };
  let step = 0;
  let idem = API.idempotencyKey();
  const today = new Date().toISOString().slice(0, 10);

  const stepper = () => `<div class="mb-steps" aria-label="Progress">${T.steps.map((s, i) =>
    `<span class="mb-step${i <= step ? ' is-active' : ''}"${i === step ? ' aria-current="step"' : ''}><b>${i + 1}</b>${s}</span>`).join('')}</div>`;

  const fields = [
    () => `
      <label class="mb-field mb-field--full"><span>${T.destination}</span><input class="booking-input" name="destination" maxlength="200" placeholder="${T.destHint}" value="${esc(data.destination || '')}"></label>
      <div class="mb-field mb-field--full"><span>${T.interests}</span><div class="mb-chips">${CATS.map(([k, l]) =>
        `<label class="mb-chip"><input type="checkbox" name="categories" value="${k}"${data.categories.includes(k) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <label class="mb-field mb-field--full"><span>${T.activities}</span><textarea class="booking-input" name="activities" rows="3" maxlength="1000">${esc(data.activities || '')}</textarea></label>`,
    () => `
      <label class="mb-field"><span>${T.from}</span><input class="booking-input" type="date" name="date_from" min="${today}" value="${esc(data.date_from || '')}"></label>
      <label class="mb-field"><span>${T.to}</span><input class="booking-input" type="date" name="date_to" min="${today}" value="${esc(data.date_to || '')}"></label>
      <label class="booking-check mb-field--full"><input type="checkbox" name="flexible_dates"${data.flexible_dates ? ' checked' : ''}><span>${T.flexible}</span></label>
      <label class="mb-field"><span>${T.adults} *</span><input class="booking-input" type="number" name="adults" min="1" max="200" required value="${data.adults}"></label>
      <label class="mb-field"><span>${T.children}</span><input class="booking-input" type="number" name="children" min="0" max="200" value="${data.children}"></label>`,
    () => `
      <label class="mb-field mb-field--full"><span>${T.accommodation}</span><input class="booking-input" name="accommodation" maxlength="500" placeholder="${T.accHint}" value="${esc(data.accommodation || '')}"></label>
      <label class="mb-field mb-field--full"><span>${T.transport}</span><input class="booking-input" name="transport" maxlength="500" placeholder="${T.transHint}" value="${esc(data.transport || '')}"></label>
      <label class="mb-field"><span>${T.budget}</span><input class="booking-input" type="number" name="budget" min="0" step="100" value="${data.budget ?? ''}"></label>
      <label class="mb-field"><span>${T.currency}</span><select class="booking-input" name="budget_currency">${['MZN', 'USD', 'ZAR', 'EUR'].map(c => `<option${data.budget_currency === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="mb-field mb-field--full"><span>${T.special}</span><textarea class="booking-input" name="special_requests" rows="3" maxlength="2000">${esc(data.special_requests || '')}</textarea></label>`,
    () => `
      <label class="mb-field mb-field--full"><span>${T.name} *</span><input class="booking-input" name="name" required maxlength="120" autocomplete="name" value="${esc(data.name || '')}"></label>
      <label class="mb-field"><span>${T.email} *</span><input class="booking-input" type="email" name="email" required autocomplete="email" value="${esc(data.email || '')}"></label>
      <label class="mb-field"><span>${T.phone} *</span><input class="booking-input" type="tel" name="phone" required maxlength="30" pattern="[\\d\\s+\\-\\(\\)]{6,30}" autocomplete="tel" value="${esc(data.phone || '')}"></label>`,
  ];

  function collect(form) {
    const fd = new FormData(form);
    if (step === 0) { data.destination = fd.get('destination').trim(); data.categories = fd.getAll('categories'); data.activities = fd.get('activities').trim(); }
    if (step === 1) {
      data.date_from = fd.get('date_from') || ''; data.date_to = fd.get('date_to') || '';
      data.flexible_dates = !!fd.get('flexible_dates'); data.adults = parseInt(fd.get('adults'), 10) || 0; data.children = parseInt(fd.get('children'), 10) || 0;
    }
    if (step === 2) {
      data.accommodation = fd.get('accommodation').trim(); data.transport = fd.get('transport').trim();
      data.budget = fd.get('budget') === '' ? null : Number(fd.get('budget')); data.budget_currency = fd.get('budget_currency'); data.special_requests = fd.get('special_requests').trim();
    }
    if (step === 3) { data.name = fd.get('name').trim(); data.email = fd.get('email').trim(); data.phone = fd.get('phone').trim(); }
  }

  function validate(form) {
    const bad = [...form.querySelectorAll('input[required], input[pattern], input[type=email], input[type=number]')].filter(i => !i.checkValidity());
    form.querySelectorAll('.is-invalid').forEach(i => i.classList.remove('is-invalid'));
    bad.forEach(i => i.classList.add('is-invalid'));
    if (bad.length) { bad[0].focus(); return T.required; }
    if (step === 1) {
      if (data.date_from && data.date_from < today) return T.datePast;
      if (data.date_from && data.date_to && data.date_to < data.date_from) return T.dateOrder;
    }
    return null;
  }

  function render(msg = '') {
    if (step === 4) return summary(msg);
    root.innerHTML = `
      <div class="mb-panel" style="max-width:760px;margin-inline:auto;">
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
    const first = form.querySelector('input:not([type=checkbox]), textarea');
    if (first && step > 0) first.focus();
  }

  function summary(msg) {
    const catNames = data.categories.map(k => (CATS.find(c => c[0] === k) || [k, k])[1]).join(', ');
    const dates = data.date_from ? `${API.date(data.date_from)}${data.date_to ? ` → ${API.date(data.date_to)}` : ''}` : T.none;
    const rows = [
      [T.destination, data.destination || T.none], [T.interests, catNames || T.none], [T.activities, data.activities || T.none],
      [T.steps[1], dates + (data.flexible_dates ? ` (${T.flexibleDates})` : '')],
      [T.guests, `${data.adults} ${T.adults.toLowerCase()}${data.children ? `, ${data.children} ${T.children.toLowerCase()}` : ''}`],
      [T.accommodation, data.accommodation || T.none], [T.transport, data.transport || T.none],
      [T.budget, data.budget ? `${data.budget_currency} ${Number(data.budget).toLocaleString('en-US')}` : T.none],
      [T.special, data.special_requests || T.none], [T.name, data.name], [T.email, data.email], [T.phone, data.phone],
    ];
    root.innerHTML = `
      <div class="mb-panel" style="max-width:760px;margin-inline:auto;">
        <h2>${T.review}</h2>
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
        destination: data.destination || undefined, categories: data.categories, flexible_dates: data.flexible_dates,
        date_from: data.date_from || undefined, date_to: data.date_to || undefined,
        accommodation: data.accommodation || undefined, transport: data.transport || undefined, activities: data.activities || undefined,
        budget: data.budget ?? undefined, budget_currency: data.budget ? data.budget_currency : undefined,
        special_requests: data.special_requests || undefined, consent: true, idempotency_key: idem, website: form.website.value,
      };
      try {
        const r = await API.post('/custom-requests', body);
        idem = API.idempotencyKey();
        root.innerHTML = `
          <div class="mb-panel mb-panel--narrow" style="text-align:center;">
            <div class="mb-success-icon"><i class='bx bx-check'></i></div>
            <h2>${T.done}</h2>
            <p class="mb-ref-label">${T.refLabel}</p><p class="mb-ref">${esc(r.request.reference)}</p>
            <p>${T.doneText}</p>
            <p style="margin-top:14px;"><a class="mb-link" href="${ROOT}${EN ? 'en' : 'pages'}/account.html">${T.account}</a></p>
          </div>`;
      } catch (err) {
        summary(`<p class="mb-alert" role="alert">${esc(API.errorText(err))}</p>`);
      }
    });
  }

  (async function start() {
    if (!(await API.available())) {
      root.innerHTML = `<p class="mb-alert" role="alert">${esc(API.errorText(new API.ApiError(0, 'network')))}</p>`;
      return;
    }
    try {
      const me = (await API.get('/auth/me')).user;
      if (me) Object.assign(data, { name: me.name, email: me.email, phone: me.phone || '' });
    } catch (_) { /* guest */ }
    render();
  })();
})();
