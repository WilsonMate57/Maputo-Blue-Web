/**
 * portal-status.js
 * Guest booking tracking: reference + secret link token (from the e-mail)
 * or reference + the e-mail address used for the booking.
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

  const T = EN ? {
    ref: 'Booking reference', email: 'E-mail used for the booking', find: 'Find my booking', another: 'Look up another booking',
    status: 'Status', experience: 'Experience', date: 'Date', guests: 'Guests', payment: 'Payment', requested: 'Requested on',
    adults: 'adult(s)', children: 'child(ren)', total: 'Total',
    pending: 'Our team is checking availability. You will receive an e-mail as soon as the booking is confirmed.',
    confirmed: 'Your booking is confirmed. See you soon!', rejected: 'We could not confirm this booking. Please contact us to find an alternative.',
    cancelled: 'This booking was cancelled.', completed: 'We hope you enjoyed it! Leave a review on the experience page.',
    childReq: 'Children price on request — our team will confirm it.',
    help: 'Questions about this booking?', whatsapp: 'Message us on WhatsApp', account: 'Create an account to see all your bookings in one place',
  } : {
    ref: 'Referência da reserva', email: 'E-mail usado na reserva', find: 'Encontrar a minha reserva', another: 'Consultar outra reserva',
    status: 'Estado', experience: 'Experiência', date: 'Data', guests: 'Participantes', payment: 'Pagamento', requested: 'Pedido em',
    adults: 'adulto(s)', children: 'criança(s)', total: 'Total',
    pending: 'A nossa equipa está a verificar a disponibilidade. Receberá um e-mail assim que a reserva for confirmada.',
    confirmed: 'A sua reserva está confirmada. Até breve!', rejected: 'Não foi possível confirmar esta reserva. Contacte-nos para encontrarmos uma alternativa.',
    cancelled: 'Esta reserva foi cancelada.', completed: 'Esperamos que tenha gostado! Deixe a sua avaliação na página da experiência.',
    childReq: 'Preço das crianças sob consulta — a nossa equipa vai confirmá-lo.',
    help: 'Dúvidas sobre esta reserva?', whatsapp: 'Fale connosco pelo WhatsApp', account: 'Crie uma conta para ver todas as suas reservas num só lugar',
  };

  const params = new URLSearchParams(location.search);

  function form(msg = '') {
    root.innerHTML = `
      <div class="mb-panel mb-panel--narrow">
        <form novalidate>
          <div class="mb-form-grid">
            <label class="mb-field mb-field--full"><span>${T.ref}</span>
              <input class="booking-input" name="reference" required placeholder="MB-XXXXXX" pattern="[Mm][Bb]-[A-Za-z0-9]{4,10}" value="${esc(params.get('ref') || '')}" autocomplete="off" style="text-transform:uppercase;"></label>
            <label class="mb-field mb-field--full"><span>${T.email}</span><input class="booking-input" type="email" name="email" required autocomplete="email"></label>
          </div>
          <div class="mb-form-msg">${msg}</div>
          <div class="mb-form-actions"><button type="submit" class="btn-primary-mb"><i class='bx bx-search-alt'></i>${T.find}</button></div>
        </form>
      </div>`;
    const f = root.querySelector('form');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const ref = f.reference.value.trim().toUpperCase();
      if (!f.reference.checkValidity() || !f.email.checkValidity()) {
        f.querySelector('.mb-form-msg').innerHTML = `<p class="mb-alert" role="alert">${esc(API.errorText(new API.ApiError(400, 'validation')))}</p>`;
        return;
      }
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      await lookup({ reference: ref, email: f.email.value.trim() });
      btn.disabled = false;
    });
  }

  function show(b) {
    const title = EN ? b.package_title_en || b.package_title : b.package_title;
    const lines = b.lines.map(l => `<li><span>${esc(EN ? l.label_en : l.label)}${l.quantity > 1 ? ` × ${l.quantity}` : ''}</span><span>${l.unit_price === null ? '—' : money(l.amount, b.currency)}</span></li>`).join('') +
      b.discounts.map(d => `<li class="is-discount"><span>${esc(d.label)}</span><span>− ${money(d.amount, b.currency)}</span></li>`).join('');
    const wa = `https://wa.me/258847121666?text=${encodeURIComponent((EN ? 'Hello Maputo Blue, I have a question about booking ' : 'Olá Maputo Blue, tenho uma questão sobre a reserva ') + b.reference)}`;
    root.innerHTML = `
      <div class="mb-panel" style="max-width:720px;margin-inline:auto;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;">
          <div><p class="mb-ref-label" style="margin:0;">${T.ref}</p><p class="mb-ref" style="margin:0;">${esc(b.reference)}</p></div>
          <span class="mb-status mb-status--${b.status}" style="font-size:.875rem;">${API.statusLabel(b.status)}</span>
        </div>
        <p class="mb-alert mb-alert--${b.status === 'confirmed' || b.status === 'completed' ? 'success' : b.status === 'pending' ? 'info' : ''}" style="margin-top:16px;">${T[b.status] || ''}</p>
        <dl class="mb-detail">
          <div><dt>${T.experience}</dt><dd>${esc(title)}</dd></div>
          <div><dt>${T.date}</dt><dd>${esc(API.date(b.start_date))}${b.end_date !== b.start_date ? ` → ${esc(API.date(b.end_date))}` : ''}</dd></div>
          <div><dt>${T.guests}</dt><dd>${b.adults} ${T.adults}${b.children ? `, ${b.children} ${T.children}` : ''}</dd></div>
          <div><dt>${T.payment}</dt><dd><span class="mb-status mb-status--${b.payment_status}">${API.statusLabel(b.payment_status)}</span></dd></div>
          <div><dt>${T.requested}</dt><dd>${esc(API.date(b.created_at))}</dd></div>
        </dl>
        <ul class="booking-breakdown">${lines}<li><strong>${T.total}</strong><strong>${money(b.total, b.currency)}</strong></li></ul>
        ${b.child_price_on_request ? `<p class="mb-alert mb-alert--info">${T.childReq}</p>` : ''}
        <div class="mb-form-actions" style="margin-top:24px;">
          <a class="btn-outline-mb" href="${wa}" target="_blank" rel="noopener"><i class='bx bxl-whatsapp'></i>${T.whatsapp}</a>
          <button type="button" class="mb-link" data-another>${T.another}</button>
        </div>
        <p style="margin-top:14px;font-size:.875rem;"><a class="mb-link" href="${ROOT}${EN ? 'en' : 'pages'}/account.html?tab=register">${T.account}</a></p>
      </div>`;
    root.querySelector('[data-another]').addEventListener('click', () => { history.replaceState(null, '', location.pathname); form(); });
  }

  async function lookup(body) {
    try {
      const r = await API.post('/bookings/lookup', body);
      show(r.booking);
    } catch (err) {
      form(`<p class="mb-alert" role="alert">${esc(API.errorText(err))}</p>`);
    }
  }

  (async function start() {
    if (!(await API.available())) {
      root.innerHTML = `<p class="mb-alert" role="alert">${esc(API.errorText(new API.ApiError(0, 'network')))}</p>`;
      return;
    }
    const ref = params.get('ref'), token = params.get('token');
    if (ref && token) {
      root.innerHTML = '<div class="mb-panel mb-panel--narrow"><div class="mb-skeleton-line"></div><div class="mb-skeleton-line" style="width:60%"></div></div>';
      await lookup({ reference: ref.toUpperCase(), token });
    } else {
      form();
    }
  })();
})();
