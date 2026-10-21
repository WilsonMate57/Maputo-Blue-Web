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
    tabs: { bookings: 'My bookings', requests: 'Custom requests', loyalty: 'Loyalty', profile: 'Profile' },
    noBookings: 'You have no bookings yet.', explore: 'Explore experiences', noRequests: 'You have not requested a custom tour yet.',
    newRequest: 'Request a custom tour', guests: 'guests', ref: 'Reference', total: 'Total', paid: 'Paid',
    details: 'Details', hide: 'Hide', cancel: 'Cancel request', requestCancel: 'Request cancellation',
    confirmCancel: 'Cancel this booking request?', confirmRequestCancel: 'Ask Maputo Blue to cancel this confirmed booking? Our cancellation policy applies.',
    cancelRequested: 'Cancellation requested — our team will contact you.',
    holdNote: 'Waiting for confirmation by our team.',
    loyaltyOff: 'The loyalty programme is not active at the moment.',
    loyaltyEligible: v => `You are eligible for a ${v} discount on your next booking — it is applied automatically when you are signed in.`,
    loyaltyProgress: (c, r) => `${c} of ${r} completed trips`,
    loyaltyVerify: 'Confirm your e-mail to start collecting loyalty benefits.',
    save: 'Save changes', saved: 'Saved.', changePw: 'Change password', currentPw: 'Current password', language: 'E-mail language',
    quote: 'Quotation', validUntil: 'valid until',
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
    tabs: { bookings: 'As minhas reservas', requests: 'Pedidos personalizados', loyalty: 'Fidelização', profile: 'Perfil' },
    noBookings: 'Ainda não tem reservas.', explore: 'Explorar experiências', noRequests: 'Ainda não pediu nenhum tour personalizado.',
    newRequest: 'Pedir tour personalizado', guests: 'pessoas', ref: 'Referência', total: 'Total', paid: 'Pago',
    details: 'Detalhes', hide: 'Ocultar', cancel: 'Cancelar pedido', requestCancel: 'Pedir cancelamento',
    confirmCancel: 'Cancelar este pedido de reserva?', confirmRequestCancel: 'Pedir à Maputo Blue o cancelamento desta reserva confirmada? Aplica-se a nossa política de cancelamento.',
    cancelRequested: 'Cancelamento pedido — a nossa equipa vai contactá-lo.',
    holdNote: 'A aguardar confirmação da nossa equipa.',
    loyaltyOff: 'O programa de fidelização não está activo de momento.',
    loyaltyEligible: v => `Tem direito a um desconto de ${v} na próxima reserva — é aplicado automaticamente com a sessão iniciada.`,
    loyaltyProgress: (c, r) => `${c} de ${r} viagens concluídas`,
    loyaltyVerify: 'Confirme o seu e-mail para começar a acumular benefícios de fidelização.',
    save: 'Guardar alterações', saved: 'Guardado.', changePw: 'Alterar palavra-passe', currentPw: 'Palavra-passe actual', language: 'Idioma dos e-mails',
    quote: 'Cotação', validUntil: 'válida até',
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
  function bookingItem(b) {
    const title = EN ? b.package_title_en || b.package_title : b.package_title;
    const canCancel = b.status === 'pending';
    const canRequest = b.status === 'confirmed' && !b.cancel_requested;
    const lines = b.lines.map(l => `<li><span>${esc(EN ? l.label_en : l.label)}${l.quantity > 1 ? ` × ${l.quantity}` : ''}</span><span>${l.unit_price === null ? '—' : money(l.amount, b.currency)}</span></li>`).join('') +
      b.discounts.map(d => `<li class="is-discount"><span>${esc(d.label)}</span><span>− ${money(d.amount, b.currency)}</span></li>`).join('');
    return `
      <article class="mb-booking-item" data-id="${b.id}">
        <div>
          <h3>${esc(title)}</h3>
          <div class="mb-booking-item__meta">
            <span><i class='bx bx-hash'></i>${esc(b.reference)}</span>
            <span><i class='bx bx-calendar'></i>${esc(API.date(b.start_date))}${b.end_date !== b.start_date ? ` → ${esc(API.date(b.end_date))}` : ''}</span>
            <span><i class='bx bx-group'></i>${b.adults + b.children} ${T.guests}</span>
          </div>
          ${b.status === 'pending' ? `<p class="mb-booking-item__meta" style="margin-top:6px;">${T.holdNote}</p>` : ''}
          ${b.cancel_requested && b.status === 'confirmed' ? `<p class="mb-booking-item__meta" style="margin-top:6px;">${T.cancelRequested}</p>` : ''}
        </div>
        <div class="mb-booking-item__side">
          <span class="mb-status mb-status--${b.status}">${API.statusLabel(b.status)}</span>
          <span class="mb-booking-item__total">${money(b.total, b.currency)}</span>
          ${b.amount_paid > 0 ? `<span class="mb-status mb-status--${b.payment_status}">${API.statusLabel(b.payment_status)}</span>` : ''}
        </div>
        <div class="mb-booking-item__actions">
          <button type="button" class="mb-btn-sm" data-toggle aria-expanded="false"><i class='bx bx-receipt'></i>${T.details}</button>
          ${canCancel ? `<button type="button" class="mb-btn-sm mb-btn-sm--danger" data-cancel><i class='bx bx-x-circle'></i>${T.cancel}</button>` : ''}
          ${canRequest ? `<button type="button" class="mb-btn-sm mb-btn-sm--danger" data-cancel><i class='bx bx-x-circle'></i>${T.requestCancel}</button>` : ''}
        </div>
        <ul class="booking-breakdown" hidden style="grid-column:1/-1;">${lines}<li><strong>${T.total}</strong><strong>${money(b.total, b.currency)}</strong></li></ul>
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
      pane.innerHTML = `<div class="mb-booking-list">${list.map(bookingItem).join('')}</div>`;
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

  async function loadRequests(pane) {
    pane.innerHTML = '<div class="mb-skeleton-line"></div>';
    try {
      const list = await API.get('/account/requests');
      if (!list.length) {
        pane.innerHTML = `<div class="mb-empty"><i class='bx bx-map-alt'></i><p>${T.noRequests}</p><a class="btn-primary-mb" href="${PAGE}/custom-tour.html">${T.newRequest}</a></div>`;
        return;
      }
      pane.innerHTML = `<div class="mb-booking-list">${list.map(r => `
        <article class="mb-booking-item">
          <div><h3>${esc(r.destination || r.reference)}</h3>
            <div class="mb-booking-item__meta"><span><i class='bx bx-hash'></i>${esc(r.reference)}</span>
            ${r.date_from ? `<span><i class='bx bx-calendar'></i>${esc(API.date(r.date_from))}${r.date_to ? ` → ${esc(API.date(r.date_to))}` : ''}</span>` : ''}
            <span><i class='bx bx-group'></i>${r.adults + r.children} ${T.guests}</span></div>
            ${r.quote ? `<p class="mb-booking-item__meta" style="margin-top:6px;">${T.quote}: <strong>${money(r.quote.total, r.quote.currency)}</strong> — ${T.validUntil} ${esc(API.date(r.quote.valid_until))}</p>` : ''}
          </div>
          <div class="mb-booking-item__side"><span class="mb-status mb-status--${r.status}">${API.statusLabel(r.status)}</span></div>
        </article>`).join('')}</div>`;
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
    const tabs = ['bookings', 'requests', 'loyalty', 'profile'];
    const active = tabs.includes(tab) ? tab : 'bookings';
    root.innerHTML = `
      ${notice}
      ${user.email_verified ? '' : `<div class="mb-alert mb-alert--info" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 18px;">
        <span style="flex:1;min-width:220px;">${T.verifyBanner}</span><button type="button" class="mb-btn-sm" data-resend>${T.resend}</button></div>`}
      <div class="mb-panel">
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;">
          <h2 style="margin:0;">${esc(T.hello(user.name.split(' ')[0]))}</h2>
          <button type="button" class="mb-btn-sm" data-logout><i class='bx bx-log-out'></i>${T.logout}</button>
        </div>
        <div class="mb-tabs" role="tablist">${tabs.map(t => `<button class="mb-tab" role="tab" data-tab="${t}" aria-selected="${t === active}">${T.tabs[t]}</button>`).join('')}</div>
        <div id="account-pane" role="tabpanel"></div>
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
    ({ bookings: loadBookings, requests: loadRequests, loyalty: loadLoyalty, profile: profilePane })[active](pane);
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
