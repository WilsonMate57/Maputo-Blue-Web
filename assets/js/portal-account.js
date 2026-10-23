/**
 * portal-account.js
 * Customer account: sign in / register / password reset / e-mail verification,
 * booking history, custom requests, loyalty status and profile.
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
  const PAGE = `${ROOT}${EN ? 'en' : 'pages'}`;

  const T = EN ? {
    login: 'Sign in', register: 'Create account', forgot: 'Forgot password?', email: 'E-mail', password: 'Password',
    name: 'Full name', phone: 'Phone (optional)', country: 'Country (optional)', pwHint: 'At least 10 characters',
    signIn: 'Sign in', create: 'Create account', sendReset: 'Send reset link', back: 'Back to sign in',
    resetSent: 'If an account exists for this e-mail, you will receive a link to reset your password.',
    newPassword: 'New password', setPassword: 'Save new password', resetDone: 'Password changed. You can now sign in.',
    verified: 'Your e-mail is confirmed. Thank you!', linked: n => `${n} earlier booking(s) were added to your account.`,
    verifyBanner: 'Please confirm your e-mail address to unlock your full booking history and loyalty benefits.',
    resend: 'Resend e-mail', resent: 'Confirmation e-mail sent.',
    hello: n => `Hello, ${n}`, logout: 'Sign out',
    tabs: { bookings: 'My bookings', invoices: 'Invoices', requests: 'Quotes', loyalty: 'Loyalty', profile: 'Profile' },
    noBookings: 'You have no bookings yet.', explore: 'Explore experiences', noRequests: 'You have not requested a quotation yet.',
    newRequest: 'Request a custom tour', guests: 'guests', ref: 'Reference', total: 'Total', paid: 'Paid',
    details: 'Details', hide: 'Hide', ticket: 'Ticket', cancel: 'Cancel request', requestCancel: 'Request cancellation',
    confirmCancel: 'Cancel this booking request?', confirmRequestCancel: 'Ask Maputo Blue to cancel this confirmed booking? Our cancellation policy applies.',
    cancelRequested: 'Cancellation requested — our team will contact you.',
    holdNote: 'Waiting for confirmation by our team.',
    loyaltyOff: 'The loyalty programme is not active at the moment.',
    loyaltyEligible: v => `You are eligible for a ${v} discount on your next booking — it is applied automatically when you are signed in.`,
    loyaltyProgress: (c, r) => `${c} of ${r} completed trips`,
    loyaltyVerify: 'Confirm your e-mail to start collecting loyalty benefits.',
    save: 'Save changes', saved: 'Saved.', changePw: 'Change password', currentPw: 'Current password', language: 'E-mail language',
    quote: 'Quotation', validUntil: 'valid until',
    invoices: 'Invoices', noInvoices: 'No invoices yet. Invoices appear here once our team issues them for your bookings.',
    invoice: 'Invoice', download: 'Download PDF', balance: 'Balance due', issued: 'Issued', due: 'Due',
    stepRequested: 'Requested', stepConfirmed: 'Confirmed', stepTrip: 'Trip', stepDone: 'Completed',
    payProgress: (p, t) => `${p} of ${t} paid`, upcoming: 'Upcoming', past: 'Past and cancelled', memberSince: 'Signed in as',
    paidNote: 'Paid in full — thank you!',
    viewQuote: 'View quotation', hideQuote: 'Hide quotation', accept: 'Accept quotation', decline: 'Decline',
    confirmAccept: 'Accept this quotation? Our team will contact you to confirm the bookings and payment.', confirmDecline: 'Decline this quotation?',
    included: 'Included', notIncluded: 'Not included', quoteValid: 'Valid until', quoteWaiting: 'Our team is preparing your quotation.',
    quoteAccepted: 'You accepted this quotation — our team will contact you.', newQuote: 'Request a quote', quotePdf: 'Download PDF',
  } : {
    login: 'Entrar', register: 'Criar conta', forgot: 'Esqueceu a palavra-passe?', email: 'E-mail', password: 'Palavra-passe',
    name: 'Nome completo', phone: 'Telefone (opcional)', country: 'País (opcional)', pwHint: 'Pelo menos 10 caracteres',
    signIn: 'Entrar', create: 'Criar conta', sendReset: 'Enviar link de recuperação', back: 'Voltar a entrar',
    resetSent: 'Se existir uma conta com este e-mail, receberá um link para redefinir a palavra-passe.',
    newPassword: 'Nova palavra-passe', setPassword: 'Guardar nova palavra-passe', resetDone: 'Palavra-passe alterada. Já pode entrar.',
    verified: 'O seu e-mail está confirmado. Obrigado!', linked: n => `${n} reserva(s) anterior(es) foram associadas à sua conta.`,
    verifyBanner: 'Confirme o seu endereço de e-mail para ver todo o histórico de reservas e aceder aos benefícios de fidelização.',
    resend: 'Reenviar e-mail', resent: 'E-mail de confirmação enviado.',
    hello: n => `Olá, ${n}`, logout: 'Terminar sessão',
    tabs: { bookings: 'As minhas reservas', invoices: 'Facturas', requests: 'Cotações', loyalty: 'Fidelização', profile: 'Perfil' },
    noBookings: 'Ainda não tem reservas.', explore: 'Explorar experiências', noRequests: 'Ainda não pediu nenhuma cotação.',
    newRequest: 'Pedir tour personalizado', guests: 'pessoas', ref: 'Referência', total: 'Total', paid: 'Pago',
    details: 'Detalhes', hide: 'Ocultar', ticket: 'Ticket', cancel: 'Cancelar pedido', requestCancel: 'Pedir cancelamento',
    confirmCancel: 'Cancelar este pedido de reserva?', confirmRequestCancel: 'Pedir à Maputo Blue o cancelamento desta reserva confirmada? Aplica-se a nossa política de cancelamento.',
    cancelRequested: 'Cancelamento pedido — a nossa equipa vai contactá-lo.',
    holdNote: 'A aguardar confirmação da nossa equipa.',
    loyaltyOff: 'O programa de fidelização não está activo de momento.',
    loyaltyEligible: v => `Tem direito a um desconto de ${v} na próxima reserva — é aplicado automaticamente com a sessão iniciada.`,
    loyaltyProgress: (c, r) => `${c} de ${r} viagens concluídas`,
    loyaltyVerify: 'Confirme o seu e-mail para começar a acumular benefícios de fidelização.',
    save: 'Guardar alterações', saved: 'Guardado.', changePw: 'Alterar palavra-passe', currentPw: 'Palavra-passe actual', language: 'Idioma dos e-mails',
    quote: 'Cotação', validUntil: 'válida até',
    invoices: 'Facturas', noInvoices: 'Ainda não há facturas. As facturas aparecem aqui quando a nossa equipa as emite para as suas reservas.',
    invoice: 'Factura', download: 'Descarregar PDF', balance: 'Saldo em dívida', issued: 'Emitida', due: 'Vence',
    stepRequested: 'Pedido', stepConfirmed: 'Confirmada', stepTrip: 'Viagem', stepDone: 'Concluída',
    payProgress: (p, t) => `${p} de ${t} pagos`, upcoming: 'Próximas', past: 'Anteriores e canceladas', memberSince: 'Sessão iniciada como',
    paidNote: 'Paga na totalidade — obrigado!',
    viewQuote: 'Ver cotação', hideQuote: 'Ocultar cotação', accept: 'Aceitar cotação', decline: 'Recusar',
    confirmAccept: 'Aceitar esta cotação? A nossa equipa vai contactá-lo para confirmar as reservas e o pagamento.', confirmDecline: 'Recusar esta cotação?',
    included: 'Incluído', notIncluded: 'Não incluído', quoteValid: 'Válida até', quoteWaiting: 'A nossa equipa está a preparar a sua cotação.',
    quoteAccepted: 'Aceitou esta cotação — a nossa equipa vai contactá-lo.', newQuote: 'Pedir cotação', quotePdf: 'Descarregar PDF',
  };

  const params = new URLSearchParams(location.search);
  let user = null;

  function alertBox(msg, kind) {
    return `<p class="mb-alert${kind ? ' mb-alert--' + kind : ''}" role="${kind === 'success' || kind === 'info' ? 'status' : 'alert'}">${msg}</p>`;
  }
  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = busy;
    if (busy) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i>${btn.textContent}`; }
    else if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
  /** Wire a form: run fn(values) and show errors inside the form. */
  function handle(form, fn) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const out = form.querySelector('.mb-form-msg');
      out.innerHTML = '';
      const btn = form.querySelector('[type=submit]');
      setBusy(btn, true);
      try { await fn(Object.fromEntries(new FormData(form)), out); }
      catch (err) { out.innerHTML = alertBox(esc(API.errorText(err))); }
      finally { setBusy(btn, false); }
    });
  }

  /* ── Signed-out views ─────────────────────────────────────── */
  function authView(tab = 'login', notice = '') {
    root.innerHTML = `
      <div class="mb-panel mb-panel--narrow">
        ${notice}
        <div class="mb-tabs" role="tablist">
          <button class="mb-tab" role="tab" data-tab="login" aria-selected="${tab === 'login'}">${T.login}</button>
          <button class="mb-tab" role="tab" data-tab="register" aria-selected="${tab === 'register'}">${T.register}</button>
        </div>
        <div id="auth-pane"></div>
      </div>`;
    root.querySelectorAll('.mb-tab').forEach(b => b.addEventListener('click', () => authView(b.dataset.tab)));
    const pane = root.querySelector('#auth-pane');
    if (tab === 'login') {
      pane.innerHTML = `
        <form novalidate>
          <div class="mb-form-grid">
            <label class="mb-field mb-field--full"><span>${T.email}</span><input class="booking-input" type="email" name="email" required autocomplete="email"></label>
            <label class="mb-field mb-field--full"><span>${T.password}</span><input class="booking-input" type="password" name="password" required autocomplete="current-password"></label>
          </div>
          <div class="mb-form-msg"></div>
          <div class="mb-form-actions">
            <button type="submit" class="btn-primary-mb"><i class='bx bx-log-in'></i>${T.signIn}</button>
            <button type="button" class="mb-link" data-forgot>${T.forgot}</button>
          </div>
        </form>`;
      pane.querySelector('[data-forgot]').addEventListener('click', forgotView);
      handle(pane.querySelector('form'), async v => {
        const r = await API.post('/auth/login', { email: v.email, password: v.password });
        user = r.user;
        dashboard();
      });
    } else {
      pane.innerHTML = `
        <form novalidate>
          <div class="mb-form-grid">
            <label class="mb-field mb-field--full"><span>${T.name}</span><input class="booking-input" name="name" required minlength="2" maxlength="120" autocomplete="name"></label>
            <label class="mb-field mb-field--full"><span>${T.email}</span><input class="booking-input" type="email" name="email" required autocomplete="email"></label>
            <label class="mb-field"><span>${T.phone}</span><input class="booking-input" type="tel" name="phone" maxlength="30" autocomplete="tel"></label>
            <label class="mb-field"><span>${T.country}</span><input class="booking-input" name="country" maxlength="60" autocomplete="country-name"></label>
            <label class="mb-field mb-field--full"><span>${T.password} <small>(${T.pwHint})</small></span><input class="booking-input" type="password" name="password" required minlength="10" autocomplete="new-password"></label>
          </div>
          <div class="mb-hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
          <div class="mb-form-msg"></div>
          <div class="mb-form-actions"><button type="submit" class="btn-primary-mb"><i class='bx bx-user-plus'></i>${T.create}</button></div>
        </form>`;
      handle(pane.querySelector('form'), async v => {
        const r = await API.post('/auth/register', { name: v.name, email: v.email, password: v.password,
          phone: v.phone || undefined, country: v.country || undefined, locale: LANG, website: v.website });
        user = r.user;
        dashboard();
      });
    }
  }

  function forgotView() {
    root.innerHTML = `
      <div class="mb-panel mb-panel--narrow">
        <h2>${T.forgot}</h2>
        <form novalidate>
          <label class="mb-field"><span>${T.email}</span><input class="booking-input" type="email" name="email" required autocomplete="email"></label>
          <div class="mb-form-msg"></div>
          <div class="mb-form-actions">
            <button type="submit" class="btn-primary-mb">${T.sendReset}</button>
            <button type="button" class="mb-link" data-back>${T.back}</button>
          </div>
        </form>
      </div>`;
    root.querySelector('[data-back]').addEventListener('click', () => authView('login'));
    handle(root.querySelector('form'), async (v, out) => {
      await API.post('/auth/request-password-reset', { email: v.email });
      out.innerHTML = alertBox(T.resetSent, 'success');
    });
  }

  function resetView(token) {
    root.innerHTML = `
      <div class="mb-panel mb-panel--narrow">
        <h2>${T.newPassword}</h2>
        <form novalidate>
          <label class="mb-field"><span>${T.newPassword} <small>(${T.pwHint})</small></span><input class="booking-input" type="password" name="password" required minlength="10" autocomplete="new-password"></label>
          <div class="mb-form-msg"></div>
          <div class="mb-form-actions"><button type="submit" class="btn-primary-mb">${T.setPassword}</button></div>
        </form>
      </div>`;
    handle(root.querySelector('form'), async v => {
      await API.post('/auth/reset-password', { token, password: v.password });
      history.replaceState(null, '', location.pathname);
      authView('login', alertBox(T.resetDone, 'success'));
    });
  }

  /* ── Signed-in dashboard ──────────────────────────────────── */
  const TAB_ICONS = { bookings: 'bx-calendar-check', invoices: 'bx-receipt', requests: 'bx-message-square-detail', loyalty: 'bx-award', profile: 'bx-user' };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Maputo' }).format(new Date());

  /** Requested → Confirmed → Trip → Completed, with the current step highlighted. */
  function journey(b) {
    if (b.status === 'cancelled' || b.status === 'rejected') return '';
    const reached = { pending: 1, confirmed: 2, completed: 4 }[b.status] || 1;
    const trip = b.status === 'confirmed' && b.start_date <= today ? 3 : reached;
    const steps = [T.stepRequested, T.stepConfirmed, T.stepTrip, T.stepDone];
    return `<ol class="bk-journey" aria-label="${esc(API.statusLabel(b.status))}">${steps.map((s, k) =>
      `<li class="${k < trip ? 'is-done' : ''}${k === trip - 1 ? ' is-current' : ''}">${esc(s)}</li>`).join('')}</ol>`;
  }

  function invoiceRow(inv) {
    if (!inv) return '';
    return `<div class="bk-invoice">
      <i class='bx bx-receipt' aria-hidden="true"></i>
      <span><strong>${T.invoice} ${esc(inv.number)}</strong>
        <small>${T.issued} ${esc(API.date(inv.issue_date))}${inv.balance > 0 && inv.due_date ? ` · ${T.due} ${esc(API.date(inv.due_date))}` : ''}</small></span>
      <span class="mb-status mb-status--${inv.status}">${API.statusLabel(inv.status)}</span>
      <a class="mb-btn-sm" href="/api/account/invoices/${encodeURIComponent(inv.id)}/pdf" download><i class='bx bx-download'></i>PDF</a>
    </div>`;
  }

  function bookingItem(b) {
    const title = EN ? b.package_title_en || b.package_title : b.package_title;
    const canCancel = b.status === 'pending';
    const canRequest = b.status === 'confirmed' && !b.cancel_requested;
    const owed = b.invoice ? b.invoice.total : b.total;
    const paidPct = owed > 0 ? Math.min(100, Math.round((b.amount_paid / owed) * 100)) : 0;
    const lines = b.lines.map(l => `<li><span>${esc(EN ? l.label_en : l.label)}${l.quantity > 1 && !l.qty_in_label ? ` × ${l.quantity}` : ''}</span><span>${l.unit_price === null ? '—' : money(l.amount, b.currency)}</span></li>`).join('') +
      b.discounts.map(d => `<li class="is-discount"><span>${esc(d.label)}</span><span>− ${money(d.amount, b.currency)}</span></li>`).join('');
    const d = new Date(b.start_date + 'T12:00:00');
    return `
      <article class="mb-booking-item bk-card" data-id="${b.id}">
        <div class="bk-card__date" aria-hidden="true"><b>${d.getDate()}</b><span>${esc(d.toLocaleDateString(EN ? 'en-GB' : 'pt-PT', { month: 'short' }).replace('.', ''))}</span><small>${d.getFullYear()}</small></div>
        <div class="bk-card__main">
          <div class="bk-card__top">
            <h3>${esc(title)}</h3>
            <span class="mb-status mb-status--${b.status}">${API.statusLabel(b.status)}</span>
          </div>
          <div class="mb-booking-item__meta">
            <span><i class='bx bx-hash'></i>${esc(b.reference)}</span>
            <span><i class='bx bx-calendar'></i>${esc(API.date(b.start_date))}${b.end_date !== b.start_date ? ` → ${esc(API.date(b.end_date))}` : ''}</span>
            <span><i class='bx bx-group'></i>${b.adults + b.children} ${T.guests}</span>
          </div>
          ${journey(b)}
          ${b.status === 'pending' ? `<p class="bk-card__note"><i class='bx bx-time-five'></i>${T.holdNote}</p>` : ''}
          ${b.cancel_requested && b.status === 'confirmed' ? `<p class="bk-card__note"><i class='bx bx-info-circle'></i>${T.cancelRequested}</p>` : ''}
          <div class="bk-pay">
            <div class="bk-pay__row"><span>${T.total} <strong>${money(owed, b.currency)}</strong></span>
              <span>${b.amount_paid >= owed && owed > 0 ? `<strong class="bk-pay__ok"><i class='bx bx-check-circle'></i>${T.paidNote}</strong>` : T.payProgress(money(b.amount_paid, b.currency), money(owed, b.currency))}</span></div>
            <div class="bk-pay__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${paidPct}"><span style="width:${paidPct}%"></span></div>
          </div>
          ${invoiceRow(b.invoice)}
          <div class="mb-booking-item__actions">
            <button type="button" class="mb-btn-sm" data-toggle aria-expanded="false"><i class='bx bx-list-ul'></i>${T.details}</button>
            <a class="mb-btn-sm" href="${PAGE}/ticket.html?id=${encodeURIComponent(b.id)}"><i class='bx bx-qr'></i>${T.ticket}</a>
            ${canCancel ? `<button type="button" class="mb-btn-sm mb-btn-sm--danger" data-cancel><i class='bx bx-x-circle'></i>${T.cancel}</button>` : ''}
            ${canRequest ? `<button type="button" class="mb-btn-sm mb-btn-sm--danger" data-cancel><i class='bx bx-x-circle'></i>${T.requestCancel}</button>` : ''}
          </div>
          <ul class="booking-breakdown" hidden>${lines}<li><strong>${T.total}</strong><strong>${money(b.total, b.currency)}</strong></li></ul>
        </div>
      </article>`;
  }

  async function loadBookings(pane) {
    pane.innerHTML = '<div class="mb-skeleton-line"></div><div class="mb-skeleton-line" style="width:70%"></div>';
    try {
      const list = await API.get('/account/bookings');
      if (!list.length) {
        pane.innerHTML = `<div class="mb-empty"><i class='bx bx-calendar-x'></i><p>${T.noBookings}</p><a class="btn-primary-mb" href="${PAGE}/tours.html">${T.explore}</a></div>`;
        return;
      }
      const upcoming = list.filter(b => ['pending', 'confirmed'].includes(b.status) && b.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
      const past = list.filter(b => !upcoming.includes(b));
      pane.innerHTML = [[T.upcoming, upcoming], [T.past, past]].filter(([, l]) => l.length).map(([h, l]) => `
        <h3 class="acct__group">${h} <span>${l.length}</span></h3>
        <div class="mb-booking-list">${l.map(bookingItem).join('')}</div>`).join('');
      pane.querySelectorAll('.mb-booking-item').forEach(el => {
        const b = list.find(x => x.id === el.dataset.id);
        el.querySelector('[data-toggle]').addEventListener('click', e => {
          const ul = el.querySelector('.booking-breakdown');
          ul.hidden = !ul.hidden;
          e.currentTarget.setAttribute('aria-expanded', String(!ul.hidden));
          e.currentTarget.lastChild.textContent = ul.hidden ? T.details : T.hide;
        });
        const c = el.querySelector('[data-cancel]');
        if (c) c.addEventListener('click', async () => {
          if (!confirm(b.status === 'pending' ? T.confirmCancel : T.confirmRequestCancel)) return;
          c.disabled = true;
          try { await API.post(`/account/bookings/${b.id}/cancel`, {}); loadBookings(pane); }
          catch (err) { c.disabled = false; alert(API.errorText(err)); }
        });
      });
    } catch (err) {
      pane.innerHTML = alertBox(esc(API.errorText(err)));
      if (err.status === 401) authView('login');
    }
  }

  async function loadInvoices(pane) {
    pane.innerHTML = '<div class="mb-skeleton-line"></div>';
    try {
      const list = await API.get('/account/invoices');
      if (!list.length) { pane.innerHTML = `<div class="mb-empty"><i class='bx bx-receipt'></i><p>${T.noInvoices}</p></div>`; return; }
      pane.innerHTML = `<div class="inv-list">${list.map(inv => `
        <article class="inv-row">
          <div><strong class="inv-row__no">${esc(inv.number)}</strong>
            <small>${T.ref} ${esc(inv.booking_reference)} · ${T.issued} ${esc(API.date(inv.issue_date))}</small></div>
          <div class="inv-row__money"><span>${T.total} <b>${money(inv.total, inv.currency)}</b></span>
            <span>${T.paid} <b>${money(inv.amount_paid, inv.currency)}</b></span>
            <span>${T.balance} <b class="${inv.balance > 0 ? 'is-due' : ''}">${money(inv.balance, inv.currency)}</b></span></div>
          <span class="mb-status mb-status--${inv.status}">${API.statusLabel(inv.status)}</span>
          ${inv.doc_status === 'issued' || inv.doc_status === 'cancelled' ? `<a class="mb-btn-sm" href="/api/account/invoices/${encodeURIComponent(inv.id)}/pdf" download><i class='bx bx-download'></i>${T.download}</a>` : ''}
        </article>`).join('')}</div>`;
    } catch (err) { pane.innerHTML = alertBox(esc(API.errorText(err))); }
  }

  async function loadRequests(pane) {
    pane.innerHTML = '<div class="mb-skeleton-line"></div>';
    try {
      const list = await API.get('/account/requests');
      if (!list.length) {
        pane.innerHTML = `<div class="mb-empty"><i class='bx bx-map-alt'></i><p>${T.noRequests}</p><a class="btn-primary-mb" href="${PAGE}/custom-tour.html">${T.newQuote}</a></div>`;
        return;
      }
      pane.innerHTML = `<div class="mb-booking-list">${list.map(r => `
        <article class="mb-booking-item" data-req="${r.id}">
          <div><h3>${esc((r.items && r.items.length ? r.items.map(i => (EN ? i.title_en : i.title)).slice(0, 2).join(' + ') + (r.items.length > 2 ? ` +${r.items.length - 2}` : '') : '') || r.destination || r.reference)}</h3>
            <div class="mb-booking-item__meta"><span><i class='bx bx-hash'></i>${esc(r.reference)}</span>
            ${r.date_from ? `<span><i class='bx bx-calendar'></i>${esc(API.date(r.date_from))}${r.date_to ? ` → ${esc(API.date(r.date_to))}` : ''}</span>` : ''}
            <span><i class='bx bx-group'></i>${r.adults + r.children} ${T.guests}</span></div>
            ${r.items && r.items.length ? `<div class="rq-items">${r.items.map(i => `<span>${esc(EN ? i.title_en : i.title)}${i.date ? ` · ${esc(API.date(i.date))}` : ''}</span>`).join('')}</div>` : ''}
          </div>
          <div class="mb-booking-item__side"><span class="mb-status mb-status--${r.status}">${API.statusLabel(r.status)}</span></div>
          ${r.quote ? `<div class="rq-quote">
              <div class="rq-quote__head"><span><span class="mb-status mb-status--${r.quote.status}">${API.statusLabel(r.quote.status)}</span>
                <small style="margin-left:8px;color:var(--text-muted);">${T.quoteValid} ${esc(API.date(r.quote.valid_until))}</small></span>
                <span class="rq-quote__total">${money(r.quote.total, r.quote.currency)}</span></div>
              <div data-quote-body hidden></div>
              <div class="rq-quote__actions"><button type="button" class="mb-btn-sm" data-view-quote="${r.quote.id}" aria-expanded="false"><i class='bx bx-file'></i>${T.viewQuote}</button>
                <a class="mb-btn-sm" href="/api/account/quotes/${encodeURIComponent(r.quote.id)}/pdf" download><i class='bx bx-download'></i>${T.quotePdf}</a></div>
            </div>` : `<p class="mb-booking-item__meta" style="grid-column:1/-1;margin:0;">${T.quoteWaiting}</p>`}
        </article>`).join('')}</div>`;
      pane.querySelectorAll('[data-view-quote]').forEach(btn => btn.addEventListener('click', async () => {
        const box = btn.closest('.rq-quote').querySelector('[data-quote-body]');
        if (!box.hidden) { box.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.lastChild.textContent = T.viewQuote; return; }
        btn.disabled = true;
        try {
          const q = await API.get(`/account/quotes/${btn.dataset.viewQuote}`);
          box.innerHTML = `
            <ul class="booking-breakdown">${q.items.map(i => `<li><span>${esc(i.description)}${i.quantity !== 1 ? ` × ${i.quantity}` : ''}</span><span>${money(i.quantity * i.unit_price, q.currency)}</span></li>`).join('')}
              <li><strong>${T.total}</strong><strong>${money(q.total, q.currency)}</strong></li></ul>
            ${q.inclusions ? `<p class="rq-quote__text"><strong>${T.included}:</strong> ${esc(q.inclusions)}</p>` : ''}
            ${q.exclusions ? `<p class="rq-quote__text"><strong>${T.notIncluded}:</strong> ${esc(q.exclusions)}</p>` : ''}
            ${q.message ? `<p class="rq-quote__text">${esc(q.message)}</p>` : ''}
            ${q.status === 'sent' ? `<div class="rq-quote__actions"><button type="button" class="btn-primary-mb" data-answer="accept"><i class='bx bx-check'></i>${T.accept}</button>
              <button type="button" class="btn-outline-mb" data-answer="decline">${T.decline}</button></div>`
              : q.status === 'accepted' ? `<p class="mb-alert mb-alert--success" style="margin-top:12px;">${T.quoteAccepted}</p>` : ''}`;
          box.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
          btn.lastChild.textContent = T.hideQuote;
          box.querySelectorAll('[data-answer]').forEach(a => a.addEventListener('click', async () => {
            const accept = a.dataset.answer === 'accept';
            if (!confirm(accept ? T.confirmAccept : T.confirmDecline)) return;
            a.disabled = true;
            try { await API.post(`/account/quotes/${q.id}/respond`, { decision: a.dataset.answer }); loadRequests(pane); }
            catch (err) { a.disabled = false; alert(API.errorText(err)); }
          }));
        } catch (err) { alert(API.errorText(err)); }
        finally { btn.disabled = false; }
      }));
    } catch (err) { pane.innerHTML = alertBox(esc(API.errorText(err))); }
  }

  async function loadLoyalty(pane) {
    pane.innerHTML = '<div class="mb-skeleton-line"></div>';
    try {
      const s = await API.get('/account/loyalty');
      if (!s.enabled) { pane.innerHTML = `<div class="mb-empty"><i class='bx bx-award'></i><p>${T.loyaltyOff}</p></div>`; return; }
      const value = s.kind === 'percent' ? `${s.value}%` : money(s.value, 'MZN');
      const pct = Math.min(100, Math.round((s.completed / Math.max(s.required, 1)) * 100));
      pane.innerHTML = `
        <div class="mb-loyalty">
          <i class='bx bxs-award mb-loyalty__icon'></i>
          <div style="flex:1;">
            <strong>${s.eligible ? T.loyaltyEligible(value) : T.loyaltyProgress(s.completed, s.required)}</strong>
            ${s.reason === 'email_not_verified' ? `<p style="margin:6px 0 0;opacity:.85;">${T.loyaltyVerify}</p>` : ''}
            ${s.eligible ? '' : `<div class="mb-loyalty__bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`}
          </div>
        </div>`;
    } catch (err) { pane.innerHTML = alertBox(esc(API.errorText(err))); }
  }

  function profilePane(pane) {
    pane.innerHTML = `
      <form novalidate data-profile>
        <div class="mb-form-grid">
          <label class="mb-field mb-field--full"><span>${T.name}</span><input class="booking-input" name="name" required minlength="2" maxlength="120" value="${esc(user.name)}"></label>
          <label class="mb-field"><span>${T.email}</span><input class="booking-input" value="${esc(user.email)}" disabled></label>
          <label class="mb-field"><span>${T.phone}</span><input class="booking-input" name="phone" maxlength="30" value="${esc(user.phone || '')}"></label>
          <label class="mb-field"><span>${T.country}</span><input class="booking-input" name="country" maxlength="60" value="${esc(user.country || '')}"></label>
          <label class="mb-field"><span>${T.language}</span><select class="booking-input" name="locale"><option value="pt"${user.locale === 'pt' ? ' selected' : ''}>Português</option><option value="en"${user.locale === 'en' ? ' selected' : ''}>English</option></select></label>
        </div>
        <div class="mb-form-msg"></div>
        <div class="mb-form-actions"><button type="submit" class="btn-primary-mb">${T.save}</button></div>
      </form>
      <hr style="margin:28px 0;border-color:var(--border-light);">
      <h2>${T.changePw}</h2>
      <form novalidate data-password>
        <div class="mb-form-grid">
          <label class="mb-field"><span>${T.currentPw}</span><input class="booking-input" type="password" name="current_password" required autocomplete="current-password"></label>
          <label class="mb-field"><span>${T.newPassword} <small>(${T.pwHint})</small></span><input class="booking-input" type="password" name="new_password" required minlength="10" autocomplete="new-password"></label>
        </div>
        <div class="mb-form-msg"></div>
        <div class="mb-form-actions"><button type="submit" class="btn-outline-mb">${T.changePw}</button></div>
      </form>`;
    handle(pane.querySelector('[data-profile]'), async (v, out) => {
      const r = await API.patch('/account/profile', { name: v.name, phone: v.phone || null, country: v.country || null, locale: v.locale });
      user = r.user;
      out.innerHTML = alertBox(T.saved, 'success');
    });
    handle(pane.querySelector('[data-password]'), async (v, out) => {
      await API.post('/account/password', v);
      pane.querySelector('[data-password]').reset();
      out.innerHTML = alertBox(T.saved, 'success');
    });
  }

  function dashboard(notice = '') {
    const tab = (location.hash || '#bookings').slice(1);
    const tabs = ['bookings', 'invoices', 'requests', 'loyalty', 'profile'];
    const active = tabs.includes(tab) ? tab : 'bookings';
    const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    root.innerHTML = `
      ${notice}
      ${user.email_verified ? '' : `<div class="mb-alert mb-alert--info" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 18px;">
        <span style="flex:1;min-width:220px;">${T.verifyBanner}</span><button type="button" class="mb-btn-sm" data-resend>${T.resend}</button></div>`}
      <div class="acct">
        <aside class="acct__side">
          <div class="acct__profile">
            <span class="acct__avatar" aria-hidden="true">${esc(initials)}</span>
            <div><strong>${esc(T.hello(user.name.split(' ')[0]))}</strong><small>${T.memberSince} ${esc(user.email)}</small></div>
          </div>
          <nav class="acct__nav" role="tablist" aria-orientation="vertical">${tabs.map(t => `<button class="mb-tab acct__tab" role="tab" data-tab="${t}" aria-selected="${t === active}"><i class='bx ${TAB_ICONS[t]}' aria-hidden="true"></i>${T.tabs[t]}</button>`).join('')}</nav>
          <button type="button" class="mb-btn-sm acct__logout" data-logout><i class='bx bx-log-out'></i>${T.logout}</button>
        </aside>
        <section class="acct__main mb-panel">
          <h2 class="acct__title">${T.tabs[active]}</h2>
          <div id="account-pane" role="tabpanel"></div>
        </section>
      </div>`;
    const pane = root.querySelector('#account-pane');
    root.querySelectorAll('.mb-tab').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.tab; dashboard(); }));
    root.querySelector('[data-logout]').addEventListener('click', async () => {
      await API.post('/auth/logout').catch(() => {});
      user = null;
      authView('login');
    });
    const resend = root.querySelector('[data-resend]');
    if (resend) resend.addEventListener('click', async () => {
      resend.disabled = true;
      try { await API.post('/auth/resend-verification'); resend.textContent = T.resent; }
      catch (err) { resend.disabled = false; alert(API.errorText(err)); }
    });
    ({ bookings: loadBookings, invoices: loadInvoices, requests: loadRequests, loyalty: loadLoyalty, profile: profilePane })[active](pane);
  }

  async function start() {
    root.innerHTML = '<div class="mb-panel mb-panel--narrow"><div class="mb-skeleton-line"></div><div class="mb-skeleton-line" style="width:60%"></div></div>';
    if (!(await API.available())) {
      root.innerHTML = alertBox(API.errorText(new API.ApiError(0, 'network')));
      return;
    }
    let notice = '';
    const verify = params.get('verify');
    const reset = params.get('reset');
    if (verify) {
      try {
        const r = await API.post('/auth/verify-email', { token: verify });
        notice = alertBox(T.verified + (r.linked_bookings ? ' ' + T.linked(r.linked_bookings) : ''), 'success');
      } catch (err) { notice = alertBox(esc(API.errorText(err))); }
      history.replaceState(null, '', location.pathname + location.hash);
    }
    if (reset) { resetView(reset); return; }
    try { user = (await API.get('/auth/me')).user; } catch (_) { user = null; }
    if (user) dashboard(notice); else authView(params.get('tab') === 'register' ? 'register' : 'login', notice);
  }

  start();
})();
