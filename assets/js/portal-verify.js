/**
 * portal-verify.js
 * QR verification page (?r=<reference>&k=<signature>). Read-only for the
 * public; a signed-in administrator also sees the customer and can register
 * the check-in through the protected admin API.
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
  const { esc } = API;
  const EN = API.LANG === 'en';

  const R = EN ? {
    confirmed: ['Valid booking — confirmed', 'This booking is confirmed.', 'ok'],
    completed: ['Booking already completed', 'This experience has already taken place.', 'info'],
    pending: ['Booking pending', 'The booking exists but is NOT confirmed yet.', 'warn'],
    cancelled: ['Booking cancelled', 'This booking was cancelled and is not valid.', 'bad'],
    rejected: ['Booking not accepted', 'This booking request was not accepted and is not valid.', 'bad'],
    revoked: ['Ticket replaced', 'This QR code was replaced by a newer ticket. Ask the customer for the latest version.', 'bad'],
    invalid: ['Invalid ticket', 'This QR code does not match any booking. Do not accept it.', 'bad'],
    ref: 'Reference', exp: 'Experience', date: 'Date', guests: 'Guests', payment: 'Payment',
    customer: 'Customer', phone: 'Phone', checkin: 'Register check-in', checked: 'Checked in at', open: 'Open in dashboard',
    scans: 'Recent scans', staffWord: 'staff', staffOnly: 'Staff view', confirmCheckin: 'Register the check-in for this booking?', publicNote: 'This page only checks validity. It cannot change the booking.',
  } : {
    confirmed: ['Reserva válida — confirmada', 'Esta reserva está confirmada.', 'ok'],
    completed: ['Reserva já concluída', 'Esta experiência já foi realizada.', 'info'],
    pending: ['Reserva pendente', 'A reserva existe, mas ainda NÃO está confirmada.', 'warn'],
    cancelled: ['Reserva cancelada', 'Esta reserva foi cancelada e não é válida.', 'bad'],
    rejected: ['Reserva não aceite', 'Este pedido de reserva não foi aceite e não é válido.', 'bad'],
    revoked: ['Ticket substituído', 'Este QR code foi substituído por um ticket mais recente. Peça ao cliente a versão actual.', 'bad'],
    invalid: ['Ticket inválido', 'Este QR code não corresponde a nenhuma reserva. Não o aceite.', 'bad'],
    ref: 'Referência', exp: 'Experiência', date: 'Data', guests: 'Participantes', payment: 'Pagamento',
    customer: 'Cliente', phone: 'Telefone', checkin: 'Registar check-in', checked: 'Check-in registado em', open: 'Abrir no painel',
    scans: 'Verificações recentes', staffWord: 'equipa', staffOnly: 'Vista da equipa', confirmCheckin: 'Registar o check-in desta reserva?', publicNote: 'Esta página apenas verifica a validade. Não permite alterar a reserva.',
  };
  const ICON = { ok: 'bx-check-circle', info: 'bx-flag', warn: 'bx-time-five', bad: 'bx-x-circle' };

  async function load() {
    const p = new URLSearchParams(location.search);
    if (!p.get('r') || !p.get('k')) return show({ result: 'invalid' });
    root.innerHTML = '<div class="mb-panel mb-panel--narrow"><div class="mb-skeleton-line"></div><div class="mb-skeleton-line" style="width:60%"></div></div>';
    try { show(await API.get(`/tickets/verify?r=${encodeURIComponent(p.get('r'))}&k=${encodeURIComponent(p.get('k'))}`)); }
    catch (err) { root.innerHTML = `<p class="mb-alert" role="alert">${esc(API.errorText(err))}</p>`; }
  }

  function show(r) {
    const [title, text, tone] = R[r.result] || R.invalid;
    const b = r.booking;
    const dateTxt = b ? `${API.date(b.start_date)}${b.end_date !== b.start_date ? ` → ${API.date(b.end_date)}` : ''}` : '';
    root.innerHTML = `
      <div class="verify verify--${tone}">
        <div class="verify__result" role="status">
          <i class='bx ${ICON[tone]}' aria-hidden="true"></i>
          <div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>
        </div>
        ${b ? `<dl class="mb-detail">
          <div><dt>${R.ref}</dt><dd class="mono">${esc(b.reference)}</dd></div>
          <div><dt>${R.exp}</dt><dd>${esc(b.package_title)}</dd></div>
          <div><dt>${R.date}</dt><dd>${esc(dateTxt)}</dd></div>
          <div><dt>${R.guests}</dt><dd>${b.guests}</dd></div>
          <div><dt>${R.payment}</dt><dd><span class="mb-status mb-status--${esc(b.payment_status)}">${esc(API.statusLabel(b.payment_status))}</span></dd></div>
          ${b.checked_in || b.checked_in_at ? `<div><dt>Check-in</dt><dd>✓</dd></div>` : ''}
        </dl>` : ''}
        ${r.staff ? staffBlock(r) : `<p class="muted-note">${R.publicNote}</p>`}
      </div>`;
    const btn = root.querySelector('[data-checkin]');
    if (btn) btn.addEventListener('click', async () => {
      if (!confirm(R.confirmCheckin)) return;
      btn.disabled = true;
      try { await API.post(`/admin/bookings/${b.id}/check-in`); await load(); }
      catch (err) { btn.disabled = false; alert(API.errorText(err)); }
    });
  }

  function staffBlock(r) {
    const b = r.booking;
    return `<div class="verify__staff"><h3><i class='bx bx-id-card'></i> ${R.staffOnly}</h3>
      <dl class="mb-detail"><div><dt>${R.customer}</dt><dd>${esc(b.customer_name)}</dd></div>
        <div><dt>${R.phone}</dt><dd><a class="mb-link" href="tel:${esc(b.customer_phone)}">${esc(b.customer_phone)}</a></dd></div></dl>
      ${b.checked_in_at ? `<p class="mb-alert mb-alert--success">${R.checked} ${new Date(b.checked_in_at).toLocaleString(EN ? 'en-GB' : 'pt-PT')}</p>`
        : r.result === 'confirmed' ? `<button type="button" class="btn-primary-mb" data-checkin><i class='bx bx-log-in-circle'></i>${R.checkin}</button>` : ''}
      <p style="margin-top:12px;"><a class="mb-link" href="/admin/#/bookings/${esc(b.id)}">${R.open}</a></p>
      ${r.scans && r.scans.length ? `<h4>${R.scans}</h4><ul class="verify__scans">${r.scans.map(s => `<li>${new Date(s.at).toLocaleString(EN ? 'en-GB' : 'pt-PT')} — ${esc((R[s.result] || [s.result])[0])}${s.by_staff ? ` (${R.staffWord})` : ''}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  load();
})();
