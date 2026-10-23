/**
 * ticket-view.js
 * Renders a booking ticket (HTML version of the PDF) with its actions:
 * download PDF, print, copy reference, e-mail the ticket.
 * Exposes window.MBTicket.render(container, { ticket, qr_svg }, source).
 *   source = { pdf: () => Promise<Blob>, email: () => Promise }  (how to fetch)
 *
 * @copyright  2026 Maputo Blue. All rights reserved.
 * @author     Wilson Creative Studio
 * @license    Proprietary — Unauthorised use or distribution is prohibited.
 */
(function () {
  'use strict';

  const API = window.MBApi;
  if (!API) return;
  const { LANG, esc } = API;
  const EN = LANG === 'en';
  const T = EN ? {
    download: 'Download PDF', print: 'Print', copy: 'Copy reference', copied: 'Reference copied', email: 'E-mail me the ticket',
    emailed: 'Sent! Check your inbox in a few minutes.', working: 'Please wait…', total: 'Total', payment: 'Payment',
    scanHint: 'Show this QR code to our team. It only confirms that the booking is valid.', checkedIn: 'Checked in',
  } : {
    download: 'Descarregar PDF', print: 'Imprimir', copy: 'Copiar referência', copied: 'Referência copiada', email: 'Enviar ticket por e-mail',
    emailed: 'Enviado! Verifique a sua caixa de correio dentro de alguns minutos.', working: 'Aguarde…', total: 'Total', payment: 'Pagamento',
    scanHint: 'Mostre este QR code à nossa equipa. Serve apenas para confirmar que a reserva é válida.', checkedIn: 'Check-in efectuado',
  };
  const money = (n, c) => `${c} ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

  function render(container, payload, source) {
    const d = payload.ticket;
    const L = d.labels;
    const rows = [
      [L.experience, d.package_title],
      [d.kind === 'accommodation' ? L.checkin : L.date, d.date_label],
      d.end_label ? [L.checkout, d.end_label] : null,
      [L.guests, `${d.adults} ${L.adults}${d.children ? `, ${d.children} ${L.children}` : ''}`],
      d.option_name ? [L.option, d.option_name] : null,
      d.duration ? [L.duration, d.duration] : null,
      [L.customer, d.customer_name],
      d.meeting_point ? [L.meeting, d.meeting_point] : null,
    ].filter(Boolean);
    const lines = d.lines.map(l => `<li><span>${esc(l.label)}${l.quantity > 1 && !l.qty_in_label ? ` × ${l.quantity}` : ''}</span><span>${l.amount === null ? esc(L.onRequest) : money(l.amount, d.currency)}</span></li>`).join('') +
      d.discounts.map(x => `<li class="is-discount"><span>${esc(L.discount)}: ${esc(x.label)}</span><span>- ${money(x.amount, d.currency)}</span></li>`).join('');
    const notice = d.status === 'pending' ? `<p class="ticket__notice ticket__notice--pending">${esc(L.pendingNote)}</p>`
      : (d.status === 'cancelled' || d.status === 'rejected') ? `<p class="ticket__notice ticket__notice--cancelled">${esc(L.cancelNote)}</p>` : '';
    const c = d.company;

    container.innerHTML = `
      <div class="ticket-actions" role="group" aria-label="${EN ? 'Ticket actions' : 'Acções do ticket'}">
        <button type="button" class="btn-primary-mb" data-act="pdf"><i class='bx bx-download'></i>${T.download}</button>
        <button type="button" class="btn-outline-mb" data-act="print"><i class='bx bx-printer'></i>${T.print}</button>
        <button type="button" class="btn-outline-mb" data-act="copy"><i class='bx bx-copy'></i>${T.copy}</button>
        ${source.email ? `<button type="button" class="btn-outline-mb" data-act="email"><i class='bx bx-envelope'></i>${T.email}</button>` : ''}
      </div>
      <p class="mb-alert" role="status" hidden></p>
      <article class="ticket" aria-label="${esc(d.doc_title)} ${esc(d.reference)}">
        <header class="ticket__head">
          <div class="ticket__brand">
            <img src="${API.ROOT}logo.webp" alt="${esc(c.trade_name || 'Maputo Blue')}" width="56" height="56">
            <div><strong>${esc(c.trade_name || 'Maputo Blue')}</strong>
              <small>${[c.address, c.phone, c.email, c.website].filter(Boolean).map(esc).join('<br>')}</small></div>
          </div>
          <div class="ticket__ref"><small>${esc(L.ref)}</small><strong>${esc(d.reference)}</strong>
            <small>${esc(L.issued)} ${new Date(d.issued_at).toLocaleString(EN ? 'en-GB' : 'pt-PT', { dateStyle: 'medium', timeStyle: 'short' })}</small></div>
        </header>
        <h2 class="ticket__title">${esc(d.doc_title)}</h2>
        <span class="mb-status mb-status--${esc(d.status)}">${esc(d.status_label)}</span>
        ${d.checked_in_at ? `<span class="mb-status mb-status--completed">${T.checkedIn}</span>` : ''}
        ${notice}
        <div class="ticket__body">
          <dl class="ticket__details">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd></div>`).join('')}</dl>
          <figure class="ticket__qr">${payload.qr_svg}<figcaption>${T.scanHint}</figcaption></figure>
        </div>
        <h3 class="ticket__sub">${esc(L.details)}</h3>
        <ul class="booking-breakdown ticket__lines">${lines}<li class="ticket__total"><strong>${T.total}</strong><strong>${money(d.total, d.currency)}</strong></li></ul>
        <p class="ticket__pay">${T.payment}: <strong>${esc(d.payment_label)}</strong>${d.amount_paid > 0 && d.payment_status !== 'paid' ? ` — ${esc(L.paid_amount)} ${money(d.amount_paid, d.currency)}` : ''}</p>
        ${d.child_price_on_request ? `<p class="ticket__pay">${esc(L.childOnRequest)}</p>` : ''}
        ${d.customer_notes ? `<h3 class="ticket__sub">${esc(L.notes)}</h3><p class="ticket__pay">${esc(d.customer_notes)}</p>` : ''}
        ${d.conditions ? `<h3 class="ticket__sub">${esc(L.conditions)}</h3><ul class="ticket__conditions">${d.conditions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <footer class="ticket__foot">${esc(L.disclaimer)}</footer>
      </article>`;

    const msg = container.querySelector('.mb-alert');
    const say = (text, kind) => { msg.textContent = text; msg.className = `mb-alert${kind ? ' mb-alert--' + kind : ''}`; msg.hidden = false; };
    const busy = async (btn, fn) => {
      if (btn.disabled) return;
      const html = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i>${T.working}`;
      try { await fn(); } catch (err) { say(API.errorText(err)); } finally { btn.disabled = false; btn.innerHTML = html; }
    };
    container.querySelector('[data-act=pdf]').addEventListener('click', e => busy(e.currentTarget, async () => {
      const blob = await source.pdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `maputo-blue-${d.reference}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }));
    container.querySelector('[data-act=print]').addEventListener('click', () => window.print());
    container.querySelector('[data-act=copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(d.reference); say(T.copied, 'success'); }
      catch (_) { say(d.reference, 'info'); }
    });
    const em = container.querySelector('[data-act=email]');
    if (em) em.addEventListener('click', e => busy(e.currentTarget, async () => { await source.email(); say(T.emailed, 'success'); }));
  }

  /** POST JSON and return the response as a Blob (for PDF downloads). */
  async function postBlob(path, body) {
    const res = await fetch('/api' + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new API.ApiError(res.status, j.error || 'internal', j.message || res.statusText); }
    return res.blob();
  }
  async function getBlob(path) {
    const res = await fetch('/api' + path, { credentials: 'same-origin' });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new API.ApiError(res.status, j.error || 'internal', j.message || res.statusText); }
    return res.blob();
  }

  /** Ticket sources for a guest (reference + token|email) or a signed-in customer (booking id). */
  function guestSource(creds) {
    return {
      load: () => API.post('/bookings/ticket', creds),
      pdf: () => postBlob('/bookings/ticket.pdf', creds),
      email: () => API.post('/bookings/ticket/email', creds),
    };
  }
  function accountSource(id) {
    return {
      load: () => API.get(`/account/bookings/${encodeURIComponent(id)}/ticket`),
      pdf: () => getBlob(`/account/bookings/${encodeURIComponent(id)}/ticket.pdf`),
      email: () => API.post(`/account/bookings/${encodeURIComponent(id)}/ticket/email`),
    };
  }

  window.MBTicket = { render, guestSource, accountSource };
})();
