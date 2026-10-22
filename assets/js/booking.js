/**
 * booking.js
 * Progressive enhancement of the package booking card:
 *   • availability calendar (from the server)
 *   • optional extras, private transfers and promo code
 *   • authoritative price breakdown (POST /api/quote)
 *   • booking request form → booking reference
 * When the API is unavailable nothing changes: the original WhatsApp flow stays.
 *
 * @copyright  2026 Maputo Blue. All rights reserved.
 * @author     Wilson Creative Studio
 * @license    Proprietary — Unauthorised use or distribution is prohibited.
 */
(function () {
  'use strict';

  const API = window.MBApi;
  if (!API) return;
  const { LANG, ROOT, esc, money } = API;
  const EN = LANG === 'en';

  const T = EN ? {
    date: 'Date', checkin: 'Check-in date', pick: 'Choose a date to see the exact price.',
    available: 'Available', limited: 'Few places', full: 'Full', closed: 'Unavailable',
    left: n => (n === 1 ? '1 place left' : `${n} places left`),
    extras: 'Optional extras', transfer: 'Private transfer', noTransfer: 'No transfer',
    perPerson: '/ person', perBooking: '/ booking', perNight: '/ night',
    promo: 'Have a promo code?', apply: 'Apply', promoNotApplied: 'This code is not valid for this selection.',
    discount: 'Discount', total: 'Total', estimated: 'Estimated total',
    childOnRequest: 'Children: price on request — confirmed by our team.',
    request: 'Request booking', whatsapp: 'or book via WhatsApp',
    calculating: 'Calculating…',
    formTitle: 'Your booking request', formIntro: 'We will check availability and confirm by e-mail. Nothing is charged now.',
    name: 'Full name', email: 'E-mail', phone: 'Phone / WhatsApp', country: 'Country (optional)', notes: 'Special requests (optional)',
    consent: 'I agree that Maputo Blue uses my details to handle this booking, as described in the',
    privacy: 'privacy policy', send: 'Send booking request', sending: 'Sending…', cancel: 'Back',
    successTitle: 'Request received!', successRef: 'Your booking reference',
    successText: 'Your request is <strong>pending</strong>. Our team will confirm availability shortly and you will receive an e-mail. This is not yet a confirmation.',
    track: 'Track booking', ticket: 'View ticket', copy: 'Copy reference', copied: 'Copied', createAccount: 'Create an account to see all your bookings', close: 'Close',
    required: 'Please fill in all required fields.', guests: 'Guests', adults: 'adult(s)', children: 'child(ren)',
    prev: 'Previous month', next: 'Next month', month: { month: 'long', year: 'numeric' },
    wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  } : {
    date: 'Data', checkin: 'Data de check-in', pick: 'Escolha uma data para ver o preço exacto.',
    available: 'Disponível', limited: 'Poucos lugares', full: 'Esgotado', closed: 'Indisponível',
    left: n => (n === 1 ? 'Resta 1 lugar' : `Restam ${n} lugares`),
    extras: 'Extras opcionais', transfer: 'Transfer privado', noTransfer: 'Sem transfer',
    perPerson: '/ pessoa', perBooking: '/ reserva', perNight: '/ noite',
    promo: 'Tem um código promocional?', apply: 'Aplicar', promoNotApplied: 'Este código não é válido para esta selecção.',
    discount: 'Desconto', total: 'Total', estimated: 'Total estimado',
    childOnRequest: 'Crianças: preço sob consulta — confirmado pela nossa equipa.',
    request: 'Pedir reserva', whatsapp: 'ou reserve pelo WhatsApp',
    calculating: 'A calcular…',
    formTitle: 'O seu pedido de reserva', formIntro: 'Vamos verificar a disponibilidade e confirmar por e-mail. Não é cobrado nada agora.',
    name: 'Nome completo', email: 'E-mail', phone: 'Telefone / WhatsApp', country: 'País (opcional)', notes: 'Pedidos especiais (opcional)',
    consent: 'Aceito que a Maputo Blue use os meus dados para tratar esta reserva, conforme a',
    privacy: 'política de privacidade', send: 'Enviar pedido de reserva', sending: 'A enviar…', cancel: 'Voltar',
    successTitle: 'Pedido recebido!', successRef: 'A sua referência de reserva',
    successText: 'O seu pedido está <strong>pendente</strong>. A nossa equipa vai confirmar a disponibilidade em breve e receberá um e-mail. Isto ainda não é uma confirmação.',
    track: 'Acompanhar reserva', ticket: 'Ver ticket', copy: 'Copiar referência', copied: 'Copiada', createAccount: 'Crie uma conta para ver todas as suas reservas', close: 'Fechar',
    required: 'Preencha todos os campos obrigatórios.', guests: 'Participantes', adults: 'adulto(s)', children: 'criança(s)',
    prev: 'Mês anterior', next: 'Mês seguinte', month: { month: 'long', year: 'numeric' },
    wd: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
  };

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function init(item) {
    const card = document.querySelector('.booking-card');
    const dateInput = document.getElementById('booking-date');
    const totalEl = document.getElementById('booking-total');
    const cta = document.getElementById('booking-whatsapp-btn');
    if (!card || !dateInput || !totalEl || !cta || !item || !item.booking || card.dataset.mbEnhanced) return;
    card.dataset.mbEnhanced = '1';
    const cfg = item.booking;
    const title = (EN ? item.title_en || item.name_en : item.title || item.name) || item.title || item.name;

    const state = {
      date: null, month: null, days: new Map(), extras: new Set(), transfer: null, promo: null,
      quote: null, idem: null, user: null, quoteSeq: 0,
    };

    /* ── Calendar ───────────────────────────────────────────── */
    const label = card.querySelector('label[for="booking-date"]');
    if (label && cfg.kind === 'accommodation') label.textContent = T.checkin;
    dateInput.hidden = true;
    const cal = document.createElement('div');
    cal.className = 'mb-cal';
    cal.innerHTML = `
      <div class="mb-cal__head">
        <button type="button" class="mb-cal__nav" data-step="-1" aria-label="${T.prev}"><i class='bx bx-chevron-left'></i></button>
        <span class="mb-cal__title" aria-live="polite"></span>
        <button type="button" class="mb-cal__nav" data-step="1" aria-label="${T.next}"><i class='bx bx-chevron-right'></i></button>
      </div>
      <div class="mb-cal__grid" role="grid"></div>
      <div class="mb-cal__legend">
        <span><i class="mb-dot mb-dot--open"></i>${T.available}</span>
        <span><i class="mb-dot mb-dot--limited"></i>${T.limited}</span>
        <span><i class="mb-dot mb-dot--closed"></i>${T.closed}</span>
      </div>
      <p class="mb-cal__hint" aria-live="polite">${T.pick}</p>`;
    dateInput.insertAdjacentElement('afterend', cal);
    const grid = cal.querySelector('.mb-cal__grid');
    const calTitle = cal.querySelector('.mb-cal__title');
    const calHint = cal.querySelector('.mb-cal__hint');

    const today = new Date();
    state.month = new Date(today.getFullYear(), today.getMonth(), 1);

    function optionKey() {
      const sel = document.querySelector('#boat-selector-wrap .boat-opt-card.selected input');
      return sel ? sel.value : (cfg.options.length === 1 ? cfg.options[0].key : null);
    }

    async function loadMonth() {
      const m = state.month;
      const from = ymd(m);
      const to = ymd(new Date(m.getFullYear(), m.getMonth() + 1, 0));
      const opt = cfg.per_option ? optionKey() : null;
      calTitle.textContent = m.toLocaleDateString(EN ? 'en-GB' : 'pt-PT', T.month);
      grid.setAttribute('aria-busy', 'true');
      try {
        const res = await API.get(`/availability/${encodeURIComponent(item.id)}?from=${from}&to=${to}${opt ? `&option=${encodeURIComponent(opt)}` : ''}`);
        state.days = new Map(res.days.map(d => [d.day, d]));
      } catch (err) {
        state.days = new Map();
        calHint.textContent = API.errorText(err);
      }
      grid.removeAttribute('aria-busy');
      drawMonth();
    }

    function drawMonth() {
      const m = state.month;
      const first = (new Date(m.getFullYear(), m.getMonth(), 1).getDay() + 6) % 7; // Monday first
      const count = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      let html = T.wd.map(w => `<span class="mb-cal__wd" role="columnheader">${w}</span>`).join('');
      html += '<span class="mb-cal__pad"></span>'.repeat(first);
      for (let d = 1; d <= count; d++) {
        const key = `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(d)}`;
        const info = state.days.get(key) || { status: 'closed' };
        const st = info.status === 'full' ? 'closed' : info.status;
        const selectable = info.status === 'open' || info.status === 'limited';
        const extra = info.remaining !== undefined && selectable ? ` — ${T.left(info.remaining)}` : '';
        const statusText = { open: T.available, limited: T.limited, full: T.full }[info.status] || T.closed;
        const lbl = `${new Date(key + 'T12:00:00').toLocaleDateString(EN ? 'en-GB' : 'pt-PT', { day: 'numeric', month: 'long' })} — ${statusText}${extra}`;
        html += `<button type="button" role="gridcell" class="mb-cal__day mb-cal__day--${st}${state.date === key ? ' is-selected' : ''}"
          data-day="${key}" ${selectable ? '' : 'disabled'} aria-label="${esc(lbl)}" aria-pressed="${state.date === key}">${d}</button>`;
      }
      grid.innerHTML = html;
      const prev = cal.querySelector('[data-step="-1"]');
      prev.disabled = m.getFullYear() === today.getFullYear() && m.getMonth() === today.getMonth();
    }

    cal.addEventListener('click', e => {
      const nav = e.target.closest('.mb-cal__nav');
      if (nav && !nav.disabled) {
        state.month = new Date(state.month.getFullYear(), state.month.getMonth() + Number(nav.dataset.step), 1);
        loadMonth();
        return;
      }
      const day = e.target.closest('.mb-cal__day');
      if (!day || day.disabled) return;
      state.date = day.dataset.day;
      dateInput.value = state.date;
      dateInput.dispatchEvent(new Event('change', { bubbles: true })); // keeps the legacy price logic in sync
      const info = state.days.get(state.date);
      calHint.textContent = info && info.remaining !== undefined ? T.left(info.remaining) : '';
      drawMonth();
      requote();
    });

    /* ── Extras / transfer / promo ─────────────────────────── */
    const perLabel = per => (per === 'person' ? T.perPerson : per === 'night' ? T.perNight : T.perBooking);
    const totalRow = card.querySelector('.booking-total-row');
    const extrasBox = document.createElement('div');
    extrasBox.className = 'booking-extras';
    let extrasHtml = '';
    if (cfg.extras.length) {
      extrasHtml += `<fieldset class="booking-extras__group"><legend>${T.extras}</legend>` +
        cfg.extras.map(x => `<label class="booking-check"><input type="checkbox" name="mb-extra" value="${esc(x.key)}">
          <span>${esc(EN ? x.name_en || x.name : x.name)}</span><em>${money(x.price, item.currency)} ${perLabel(x.per)}</em></label>`).join('') + '</fieldset>';
    }
    if (cfg.transfers.length) {
      extrasHtml += `<fieldset class="booking-extras__group"><legend>${T.transfer}</legend>
        <label class="booking-check"><input type="radio" name="mb-transfer" value="" checked><span>${T.noTransfer}</span></label>` +
        cfg.transfers.map(x => `<label class="booking-check"><input type="radio" name="mb-transfer" value="${esc(x.key)}">
          <span>${esc(EN ? x.name_en || x.name : x.name)}</span><em>${money(x.price, item.currency)} ${perLabel(x.per)}</em></label>`).join('') + '</fieldset>';
    }
    extrasHtml += `<details class="booking-promo"><summary>${T.promo}</summary>
      <div class="booking-promo__row"><input type="text" class="booking-input" id="mb-promo" maxlength="40" autocomplete="off" aria-label="${T.promo}">
      <button type="button" class="btn-outline-mb" id="mb-promo-apply">${T.apply}</button></div></details>
      <ul class="booking-breakdown" aria-live="polite"></ul>
      <p class="mb-alert" role="alert" hidden></p>`;
    extrasBox.innerHTML = extrasHtml;
    if (totalRow) totalRow.insertAdjacentElement('beforebegin', extrasBox);
    const breakdown = extrasBox.querySelector('.booking-breakdown');
    const alertEl = extrasBox.querySelector('.mb-alert');

    extrasBox.addEventListener('change', e => {
      if (e.target.name === 'mb-extra') e.target.checked ? state.extras.add(e.target.value) : state.extras.delete(e.target.value);
      if (e.target.name === 'mb-transfer') state.transfer = e.target.value || null;
      requote();
    });
    extrasBox.querySelector('#mb-promo-apply').addEventListener('click', () => {
      state.promo = extrasBox.querySelector('#mb-promo').value.trim() || null;
      requote();
    });

    // Guests & option changes (legacy steppers / boat selector)
    ['adults-minus', 'adults-plus', 'children-minus', 'children-plus'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.addEventListener('click', () => setTimeout(requote, 0));
    });
    const boats = document.getElementById('boat-selector-wrap');
    if (boats) boats.addEventListener('click', () => setTimeout(() => { if (cfg.per_option) loadMonth(); requote(); }, 0));

    function guests() {
      const a = parseInt((document.getElementById('adults-count') || {}).textContent, 10);
      const c = parseInt((document.getElementById('children-count') || {}).textContent, 10);
      const groupPriced = cfg.unit === 'per_group';
      return { adults: Number.isFinite(a) ? a : 1, children: Number.isFinite(c) && !groupPriced ? c : 0 };
    }

    function selection() {
      const g = guests();
      return { package_id: item.id, date: state.date, adults: g.adults, children: g.children, option_key: optionKey(),
        extras: [...state.extras], transfer_key: state.transfer, promo_code: state.promo };
    }

    let timer;
    // Returns a promise for the quote of the *current* selection, so the
    // booking button can wait for an in-flight calculation instead of failing.
    function requote() {
      clearTimeout(timer);
      if (state.resolveQuote) state.resolveQuote(null); // superseded request
      if (!state.date) { state.pending = null; return Promise.resolve(null); }
      state.pending = new Promise(resolve => {
        state.resolveQuote = resolve;
        timer = setTimeout(async () => {
          const seq = ++state.quoteSeq;
          alertEl.hidden = true;
          totalEl.textContent = T.calculating;
          try {
            const q = await API.post('/quote', selection());
            if (seq !== state.quoteSeq) return resolve(null);
            state.quote = q;
            renderQuote(q);
            resolve(q);
          } catch (err) {
            if (seq !== state.quoteSeq) return resolve(null);
            state.quote = null;
            breakdown.innerHTML = '';
            totalEl.textContent = '—';
            alertEl.textContent = API.errorText(err);
            alertEl.hidden = false;
            resolve(null);
          } finally {
            if (state.resolveQuote === resolve) { state.resolveQuote = null; state.pending = null; }
          }
        }, 200);
      });
      return state.pending;
    }

    /** Is the displayed quote the one for what is selected right now? */
    function quoteIsCurrent() {
      const q = state.quote, s = selection();
      if (!q) return false;
      const extras = q.lines.filter(l => l.type === 'extra').map(l => l.key).sort().join();
      const transfer = (q.lines.find(l => l.type === 'transfer') || {}).key || null;
      return q.date === s.date && q.adults === s.adults && q.children === s.children &&
        (q.option_key || null) === (s.option_key || null) &&
        extras === [...s.extras].sort().join() && transfer === (s.transfer_key || null);
    }

    function renderQuote(q) {
      const lines = q.lines.map(l => `<li><span>${esc(EN ? l.label_en : l.label)}${l.quantity > 1 ? ` × ${l.quantity}` : ''}</span>
        <span>${l.unit_price === null ? '—' : money(l.amount, q.currency)}</span></li>`);
      q.discounts.forEach(d => lines.push(`<li class="is-discount"><span>${esc(d.label_en && EN ? d.label_en : d.label || T.discount)}</span><span>− ${money(d.amount, q.currency)}</span></li>`));
      breakdown.innerHTML = lines.join('');
      totalEl.textContent = money(q.total, q.currency);
      const msgs = [];
      if (q.child_price_on_request) msgs.push(T.childOnRequest);
      if (q.notes.includes('promo_code_not_applied')) msgs.push(T.promoNotApplied);
      alertEl.textContent = msgs.join(' ');
      alertEl.hidden = !msgs.length;
      alertEl.classList.toggle('mb-alert--info', !!msgs.length);
      const totalLabel = card.querySelector('.booking-total-label');
      if (totalLabel) totalLabel.textContent = T.total;
    }

    /* ── CTA: booking request dialog (WhatsApp stays as alternative) ─ */
    const waAlt = document.createElement('a');
    waAlt.className = 'booking-wa-alt';
    waAlt.target = '_blank';
    waAlt.rel = 'noopener';
    waAlt.innerHTML = `<i class='bx bxl-whatsapp'></i>${T.whatsapp}`;
    cta.insertAdjacentElement('afterend', waAlt);
    const syncWa = () => { waAlt.href = cta.getAttribute('href') || 'https://wa.me/258847121666'; };
    syncWa();
    new MutationObserver(syncWa).observe(cta, { attributes: true, attributeFilter: ['href'] });

    cta.innerHTML = `<i class='bx bx-calendar-check'></i>${T.request}`;
    cta.removeAttribute('target');
    cta.setAttribute('aria-label', T.request);
    cta.setAttribute('role', 'button');
    cta.addEventListener('click', e => { e.preventDefault(); openDialog(); }, true);

    // The bottom bar duplicates the card: hide it while the card is visible
    const bar = document.getElementById('mobile-booking-bar');
    if (bar && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => bar.classList.toggle('is-hidden', e.isIntersecting), { threshold: 0.15 }).observe(card);
    }

    const mobileBtn = document.getElementById('mobile-booking-btn');
    if (mobileBtn) {
      mobileBtn.innerHTML = `<i class='bx bx-calendar-check'></i>${EN ? 'Book' : 'Reservar'}`;
      mobileBtn.removeAttribute('target');
      mobileBtn.addEventListener('click', e => {
        e.preventDefault();
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const firstDay = grid.querySelector('.mb-cal__day:not([disabled])');
        if (firstDay) setTimeout(() => firstDay.focus({ preventScroll: true }), 500);
      }, true);
    }

    const dlg = document.createElement('dialog');
    dlg.className = 'mb-dialog';
    dlg.setAttribute('aria-labelledby', 'mb-dlg-title');
    document.body.appendChild(dlg);

    async function openDialog() {
      if (!state.date) {
        calHint.textContent = T.pick;
        calHint.classList.add('is-warning');
        cal.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const firstDay = grid.querySelector('.mb-cal__day:not([disabled])');
        if (firstDay) firstDay.focus({ preventScroll: true });
        return;
      }
      // Wait for any calculation in progress; recalculate if the selection changed
      if (state.pending) await state.pending;
      if (!quoteIsCurrent()) await requote();
      if (!quoteIsCurrent()) return; // the quote failed: the error is shown in the card
      if (!state.user) {
        try { state.user = (await API.get('/auth/me')).user; } catch (_) { state.user = null; }
      }
      state.idem = state.idem || API.idempotencyKey();
      const q = state.quote;
      const u = state.user || {};
      dlg.innerHTML = `
        <form method="dialog" class="mb-dialog__body" novalidate>
          <button type="button" class="mb-dialog__close" aria-label="${T.close}"><i class='bx bx-x'></i></button>
          <h2 id="mb-dlg-title" class="mb-dialog__title">${T.formTitle}</h2>
          <p class="mb-dialog__intro">${T.formIntro}</p>
          <div class="mb-summary">
            <strong>${esc(title)}</strong>
            <span><i class='bx bx-calendar'></i>${esc(API.date(state.date))}</span>
            <span><i class='bx bx-group'></i>${q.adults} ${T.adults}${q.children ? `, ${q.children} ${T.children}` : ''}</span>
            <span class="mb-summary__total">${T.total}: ${money(q.total, q.currency)}</span>
          </div>
          <div class="mb-form-grid">
            <label class="mb-field mb-field--full"><span>${T.name} *</span><input class="booking-input" name="name" required maxlength="120" autocomplete="name" value="${esc(u.name || '')}"></label>
            <label class="mb-field"><span>${T.email} *</span><input class="booking-input" name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(u.email || '')}"></label>
            <label class="mb-field"><span>${T.phone} *</span><input class="booking-input" name="phone" type="tel" required maxlength="30" autocomplete="tel" pattern="[\\d\\s+\\-\\(\\)]{6,30}" value="${esc(u.phone || '')}"></label>
            <label class="mb-field mb-field--full"><span>${T.country}</span><input class="booking-input" name="country" maxlength="60" autocomplete="country-name" value="${esc(u.country || '')}"></label>
            <label class="mb-field mb-field--full"><span>${T.notes}</span><textarea class="booking-input" name="notes" rows="3" maxlength="1500"></textarea></label>
          </div>
          <div class="mb-hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
          <label class="booking-check booking-check--consent"><input type="checkbox" name="consent" required>
            <span>${T.consent} <a href="${ROOT}${EN ? 'en' : 'pages'}/privacy.html" target="_blank" rel="noopener">${T.privacy}</a>. *</span></label>
          <p class="mb-alert" role="alert" hidden></p>
          <div class="mb-dialog__actions">
            <button type="button" class="btn-outline-mb" data-close>${T.cancel}</button>
            <button type="submit" class="btn-primary-mb" data-submit><i class='bx bx-send'></i>${T.send}</button>
          </div>
        </form>`;
      const form = dlg.querySelector('form');
      const err = form.querySelector('.mb-alert');
      dlg.querySelectorAll('.mb-dialog__close, [data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.elements;
        form.querySelectorAll('.is-invalid').forEach(x => x.classList.remove('is-invalid'));
        const invalid = ['name', 'email', 'phone'].filter(n => !f[n].checkValidity());
        if (!f.consent.checked) invalid.push('consent');
        if (invalid.length) {
          invalid.forEach(n => (n === 'consent' ? f[n].closest('label') : f[n]).classList.add('is-invalid'));
          err.textContent = T.required; err.hidden = false;
          (f[invalid[0]]).focus();
          return;
        }
        const btn = form.querySelector('[data-submit]');
        btn.disabled = true;
        btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i>${T.sending}`;
        err.hidden = true;
        try {
          const res = await API.post('/bookings', {
            ...selection(),
            customer: { name: f.name.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), country: f.country.value.trim() || undefined },
            notes: f.notes.value.trim() || undefined, locale: LANG, consent: true,
            idempotency_key: state.idem, website: f.website.value,
          });
          showSuccess(res);
          state.idem = null; // a new request needs a new key
          loadMonth();
        } catch (e2) {
          err.textContent = API.errorText(e2); err.hidden = false;
          btn.disabled = false;
          btn.innerHTML = `<i class='bx bx-send'></i>${T.send}`;
          if (e2.status === 409) { state.idem = null; loadMonth(); }
        }
      });
      dlg.showModal();
      const firstEmpty = [...form.querySelectorAll('input:not([type=checkbox])')].find(i => !i.value);
      (firstEmpty || form.elements.consent).focus();
    }

    function showSuccess(res) {
      const b = res.booking;
      const statusPage = `${ROOT}${EN ? 'en/booking-status.html' : 'pages/booking-status.html'}?ref=${encodeURIComponent(b.reference)}${res.token ? `&token=${encodeURIComponent(res.token)}` : ''}`;
      const accountPage = `${ROOT}${EN ? 'en' : 'pages'}/account.html`;
      const ticketPage = `${ROOT}${EN ? 'en' : 'pages'}/ticket.html?ref=${encodeURIComponent(b.reference)}&token=${encodeURIComponent(res.token || '')}`;
      dlg.innerHTML = `
        <div class="mb-dialog__body mb-dialog__body--success">
          <button type="button" class="mb-dialog__close" aria-label="${T.close}"><i class='bx bx-x'></i></button>
          <div class="mb-success-icon"><i class='bx bx-check'></i></div>
          <h2 id="mb-dlg-title" class="mb-dialog__title">${T.successTitle}</h2>
          <p class="mb-ref-label">${T.successRef}</p>
          <p class="mb-ref">${esc(b.reference)}</p>
          <p>${T.successText}</p>
          <div class="mb-dialog__actions">
            ${res.token ? `<a class="btn-primary-mb" href="${ticketPage}"><i class='bx bx-receipt'></i>${T.ticket}</a>` : ''}
            <a class="btn-outline-mb" href="${statusPage}"><i class='bx bx-search-alt'></i>${T.track}</a>
            <button type="button" class="btn-outline-mb" data-copy><i class='bx bx-copy'></i>${T.copy}</button>
          </div>
          ${state.user ? '' : `<p class="mb-dialog__foot"><a href="${accountPage}">${T.createAccount}</a></p>`}
        </div>`;
      dlg.querySelectorAll('.mb-dialog__close, [data-close]').forEach(x => x.addEventListener('click', () => dlg.close()));
      const copy = dlg.querySelector('[data-copy]');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.reference); copy.innerHTML = `<i class='bx bx-check'></i>${T.copied}`; } catch (_) { /* reference is visible */ }
      });
      (dlg.querySelector('.btn-primary-mb') || copy).focus();
    }

    // A sticky sidebar taller than the viewport would hide the booking button:
    // only keep it sticky while it fits on screen.
    const sticky = card.closest('.pkg-sidebar-sticky');
    if (sticky && 'ResizeObserver' in window) {
      const fit = () => sticky.classList.toggle('is-static', sticky.offsetHeight > window.innerHeight - 120);
      new ResizeObserver(fit).observe(sticky);
      window.addEventListener('resize', fit, { passive: true });
    }

    loadMonth();
  }

  async function start(item) {
    if (!(await API.available())) return; // static hosting → keep the WhatsApp flow
    init(item);
  }

  if (window.MBPackage) start(window.MBPackage);
  document.addEventListener('mb:package-loaded', e => start(e.detail));
})();
