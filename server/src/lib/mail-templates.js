// ─────────────────────────────────────────────────────────────────────────────
// mail-templates.js — Branded, bilingual (PT/EN) transactional e-mails.
// Every template returns { subject, html, text }. All values are escaped.
// ─────────────────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (n, cur) => `${cur} ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmtDate = (d, locale) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString(locale === 'en' ? 'en-GB' : 'pt-PT', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

const STATUS = {
  pt: { pending: 'Pendente', confirmed: 'Confirmada', rejected: 'Rejeitada', cancelled: 'Cancelada', completed: 'Concluída' },
  en: { pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed' },
};

function layout({ title, intro, rows = [], body = '', cta, footerNote, locale }) {
  const rowsHtml = rows.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:20px 0;background:#F8FAFC;border-radius:10px;">
      ${rows.map(([k, v]) => `<tr><td style="padding:10px 16px;color:#64748B;font-size:13px;width:42%;border-bottom:1px solid #E2E8F0;">${esc(k)}</td><td style="padding:10px 16px;color:#0A2540;font-size:14px;font-weight:600;border-bottom:1px solid #E2E8F0;">${esc(v)}</td></tr>`).join('')}
    </table>` : '';
  const ctaHtml = cta ? `<p style="margin:24px 0;"><a href="${esc(cta.url)}" style="background:#ff8800;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block;">${esc(cta.label)}</a></p>` : '';
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:#F2E9E4;font-family:'DM Sans',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr><td style="background:#0A2540;padding:22px 28px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;">Maputo <span style="color:#00bcd4;">Blue</span></td></tr>
      <tr><td style="padding:28px;color:#334155;font-size:15px;line-height:1.6;">
        <h1 style="margin:0 0 12px;font-size:21px;color:#0A2540;">${esc(title)}</h1>
        <p style="margin:0;">${intro}</p>
        ${rowsHtml}${body}${ctaHtml}
        ${footerNote ? `<p style="margin:18px 0 0;font-size:13px;color:#64748B;">${footerNote}</p>` : ''}
      </td></tr>
      <tr><td style="background:#071B2E;padding:18px 28px;color:#94A3B8;font-size:12px;line-height:1.6;">
        Maputo Blue · Maputo, Moçambique · WhatsApp +258 84 712 1666<br>
        ${locale === 'en' ? 'You received this e-mail because of a request made on maputoblue.com.' : 'Recebeu este e-mail devido a um pedido feito em maputoblue.com.'}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function toText(title, intro, rows, extra = '') {
  return [title, '', intro.replace(/<[^>]+>/g, ''), '', ...rows.map(([k, v]) => `${k}: ${v}`), extra ? '\n' + extra : ''].join('\n');
}

function bookingRows(d, L) {
  const en = L === 'en';
  const rows = [
    [en ? 'Reference' : 'Referência', d.reference],
    [en ? 'Experience' : 'Experiência', d.package_title],
    [en ? 'Date' : 'Data', fmtDate(d.start_date, L) + (d.end_date && d.end_date !== d.start_date ? ` → ${fmtDate(d.end_date, L)}` : '')],
    [en ? 'Guests' : 'Participantes', `${d.adults} ${en ? 'adult(s)' : 'adulto(s)'}${d.children ? `, ${d.children} ${en ? 'child(ren)' : 'criança(s)'}` : ''}`],
  ];
  if (d.option_name) rows.push([en ? 'Option' : 'Opção', d.option_name]);
  rows.push([en ? 'Total' : 'Total', fmtMoney(d.total, d.currency) + (d.child_price_on_request ? (en ? ' + children on request' : ' + crianças sob consulta') : '')]);
  rows.push(['Estado / Status', STATUS[L][d.status] || d.status]);
  return rows;
}

const T = {
  booking_received(d, L) {
    const en = L === 'en';
    const title = en ? 'We received your booking request' : 'Recebemos o seu pedido de reserva';
    const intro = en
      ? `Hello ${esc(d.customer_name)}, thank you for choosing Maputo Blue. Your request is <strong>pending</strong>: our team will check availability and confirm shortly. This is not yet a confirmation.`
      : `Olá ${esc(d.customer_name)}, obrigado por escolher a Maputo Blue. O seu pedido está <strong>pendente</strong>: a nossa equipa vai verificar a disponibilidade e confirmar em breve. Isto ainda não é uma confirmação.`;
    const rows = bookingRows(d, L);
    const cta = d.status_url ? { url: d.status_url, label: en ? 'Track your booking' : 'Acompanhar a reserva' } : null;
    return { subject: `${en ? 'Booking request' : 'Pedido de reserva'} ${d.reference} — Maputo Blue`, html: layout({ title, intro, rows, cta, locale: L }), text: toText(title, intro, rows, d.status_url || '') };
  },
  booking_status(d, L) {
    const en = L === 'en';
    const map = {
      confirmed: en ? ['Your booking is confirmed', 'Great news! Your booking is <strong>confirmed</strong>. We look forward to welcoming you.'] : ['A sua reserva está confirmada', 'Boas notícias! A sua reserva está <strong>confirmada</strong>. Aguardamos por si.'],
      rejected: en ? ['We could not confirm your booking', 'Unfortunately we are unable to confirm this request for the selected date. Please contact us to find an alternative.'] : ['Não foi possível confirmar a sua reserva', 'Infelizmente não conseguimos confirmar este pedido para a data escolhida. Contacte-nos para encontrarmos uma alternativa.'],
      cancelled: en ? ['Your booking was cancelled', 'Your booking has been <strong>cancelled</strong>. If you did not request this, please contact us.'] : ['A sua reserva foi cancelada', 'A sua reserva foi <strong>cancelada</strong>. Se não pediu este cancelamento, contacte-nos.'],
      completed: en ? ['Thank you for travelling with us', 'We hope you enjoyed your experience. We would love to read your review!'] : ['Obrigado por viajar connosco', 'Esperamos que tenha gostado da experiência. Gostaríamos muito de ler a sua avaliação!'],
      updated: en ? ['Your booking was updated', 'The details of your booking were updated. Please review them below.'] : ['A sua reserva foi actualizada', 'Os detalhes da sua reserva foram actualizados. Reveja-os abaixo.'],
    };
    const [title, msg] = map[d.event] || map.updated;
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.customer_name)}, ${msg}`;
    const rows = bookingRows(d, L);
    const body = d.message ? `<p style="background:#F8FAFC;border-left:3px solid #00bcd4;padding:12px 14px;margin:0;">${esc(d.message)}</p>` : '';
    const cta = d.status_url ? { url: d.status_url, label: en ? 'View booking' : 'Ver reserva' } : null;
    return { subject: `${title} — ${d.reference}`, html: layout({ title, intro, rows, body, cta, locale: L }), text: toText(title, intro, rows, d.message || '') };
  },
  booking_ticket(d, L) {
    const en = L === 'en';
    const title = en ? 'Your booking document' : 'O seu documento de reserva';
    const statusNote = d.status === 'pending'
      ? (en ? 'Your request is still <strong>pending</strong>: this document is a receipt of the request, not a confirmation.' : 'O seu pedido ainda está <strong>pendente</strong>: este documento comprova o pedido, mas não é uma confirmação.')
      : d.status === 'confirmed' ? (en ? 'Your booking is <strong>confirmed</strong>. Please bring this document (printed or on your phone).' : 'A sua reserva está <strong>confirmada</strong>. Apresente este documento (impresso ou no telemóvel).')
        : (en ? 'Please check the current status of your booking in the attached document.' : 'Consulte o estado actual da sua reserva no documento em anexo.');
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.customer_name)}, ${en ? 'attached is the document for booking' : 'em anexo segue o documento da reserva'} <strong>${esc(d.reference)}</strong>. ${statusNote}`;
    return { subject: `${title} ${d.reference} — Maputo Blue`, html: layout({ title, intro, locale: L,
      footerNote: en ? 'This document is not a receipt or a tax document.' : 'Este documento não é um recibo nem um documento fiscal.' }), text: toText(title, intro, []) };
  },
  invoice_issued(d, L) {
    const en = L === 'en';
    const title = en ? `Invoice ${d.number}` : `Factura ${d.number}`;
    const balance = Math.max(0, Math.round((d.total - d.amount_paid) * 100) / 100);
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.customer_name)}, ${en ? 'attached is the invoice for booking' : 'em anexo segue a factura da reserva'} <strong>${esc(d.reference)}</strong>.`;
    const rows = [
      [en ? 'Invoice' : 'Factura', d.number], [en ? 'Booking' : 'Reserva', d.reference],
      [en ? 'Total' : 'Total', fmtMoney(d.total, d.currency)], [en ? 'Paid' : 'Pago', fmtMoney(d.amount_paid, d.currency)],
      [en ? 'Balance due' : 'Saldo em dívida', fmtMoney(balance, d.currency)],
    ];
    if (balance > 0 && d.due_date) rows.push([en ? 'Due date' : 'Data de vencimento', fmtDate(d.due_date, L)]);
    return { subject: `${title} — Maputo Blue`, html: layout({ title, intro, rows, locale: L }), text: toText(title, intro, rows) };
  },
  invoice_paid(d, L) {
    const en = L === 'en';
    const title = en ? `Payment received — invoice ${d.number}` : `Pagamento recebido — factura ${d.number}`;
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.customer_name)}, ${en
      ? 'we have verified your payment. Your invoice is now <strong>PAID</strong>. The updated invoice is attached.'
      : 'confirmámos o seu pagamento. A sua factura está agora <strong>PAGA</strong>. Segue em anexo a factura actualizada.'}`;
    const rows = [[en ? 'Invoice' : 'Factura', d.number], [en ? 'Booking' : 'Reserva', d.reference], [en ? 'Amount paid' : 'Valor pago', fmtMoney(d.amount_paid, d.currency)]];
    return { subject: `${title} — Maputo Blue`, html: layout({ title, intro, rows, locale: L }), text: toText(title, intro, rows) };
  },
  trip_reminder(d, L) {
    const en = L === 'en';
    const title = en ? 'Your trip is coming up' : 'A sua viagem está a chegar';
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.customer_name)}, ${en ? 'a friendly reminder of your upcoming experience with Maputo Blue.' : 'um lembrete da sua próxima experiência com a Maputo Blue.'}`;
    const rows = bookingRows(d, L);
    if (d.meeting_point) rows.push([en ? 'Meeting point' : 'Ponto de encontro', d.meeting_point]);
    return { subject: `${title} — ${d.reference}`, html: layout({ title, intro, rows, locale: L }), text: toText(title, intro, rows) };
  },
  request_received(d, L) {
    const en = L === 'en';
    const title = en ? 'We received your custom tour request' : 'Recebemos o seu pedido de tour personalizado';
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.name)}, ${en ? 'our team will review your request and send you a personalised quotation.' : 'a nossa equipa vai analisar o seu pedido e enviar-lhe uma cotação personalizada.'}`;
    const rows = [[en ? 'Reference' : 'Referência', d.reference], [en ? 'Destination' : 'Destino', d.destination || '—'], [en ? 'Guests' : 'Participantes', `${d.adults} + ${d.children}`]];
    return { subject: `${title} — ${d.reference}`, html: layout({ title, intro, rows, locale: L }), text: toText(title, intro, rows) };
  },
  quote_issued(d, L) {
    const en = L === 'en';
    const title = en ? 'Your personalised quotation' : 'A sua cotação personalizada';
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.name)}, ${en ? 'please find your quotation below. It is valid until' : 'segue a sua cotação. É válida até'} <strong>${esc(fmtDate(d.valid_until, L))}</strong>.`;
    const rows = (d.items || []).map(i => [`${i.description} × ${i.quantity}`, fmtMoney(i.quantity * i.unit_price, d.currency)]);
    rows.push(['Total', fmtMoney(d.total, d.currency)]);
    const body = [
      d.message ? `<p>${esc(d.message)}</p>` : '',
      d.inclusions ? `<p><strong>${en ? 'Included' : 'Incluído'}:</strong> ${esc(d.inclusions)}</p>` : '',
      d.exclusions ? `<p><strong>${en ? 'Not included' : 'Não incluído'}:</strong> ${esc(d.exclusions)}</p>` : '',
    ].join('');
    const cta = d.quote_url ? { url: d.quote_url, label: en ? 'View and accept quotation' : 'Ver e aceitar cotação' } : null;
    return { subject: `${title} — ${d.reference}`, html: layout({ title, intro, rows, body, cta, locale: L }), text: toText(title, intro, rows, d.quote_url || '') };
  },
  quote_accepted(d, L) {
    const en = L === 'en';
    const title = en ? 'Quotation accepted' : 'Cotação aceite';
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.name)}, ${en ? 'thank you for accepting our quotation. Our team will contact you to finalise the details.' : 'obrigado por aceitar a nossa cotação. A nossa equipa vai contactá-lo para finalizar os detalhes.'}`;
    const rows = [[en ? 'Reference' : 'Referência', d.reference], ['Total', fmtMoney(d.total, d.currency)]];
    return { subject: `${title} — ${d.reference}`, html: layout({ title, intro, rows, locale: L }), text: toText(title, intro, rows) };
  },
  verify_email(d, L) {
    const en = L === 'en';
    const title = en ? 'Confirm your e-mail' : 'Confirme o seu e-mail';
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.name)}, ${en ? 'please confirm your e-mail address to activate all account features. The link is valid for 48 hours.' : 'confirme o seu endereço de e-mail para activar todas as funcionalidades da conta. O link é válido por 48 horas.'}`;
    return { subject: `${title} — Maputo Blue`, html: layout({ title, intro, cta: { url: d.url, label: title }, locale: L }), text: toText(title, intro, [], d.url) };
  },
  reset_password(d, L) {
    const en = L === 'en';
    const title = en ? 'Reset your password' : 'Redefinir a palavra-passe';
    const intro = en ? 'We received a request to reset your password. The link is valid for 1 hour. If you did not ask for this, ignore this e-mail.' : 'Recebemos um pedido para redefinir a sua palavra-passe. O link é válido por 1 hora. Se não fez este pedido, ignore este e-mail.';
    return { subject: `${title} — Maputo Blue`, html: layout({ title, intro, cta: { url: d.url, label: title }, locale: L }), text: toText(title, intro, [], d.url) };
  },
  // ── Administrator notifications (always Portuguese) ──
  admin_new_booking(d) {
    const title = `Novo pedido de reserva ${d.reference}`;
    const intro = `Foi recebido um novo pedido de <strong>${esc(d.customer_name)}</strong> (${esc(d.customer_email)}, ${esc(d.customer_phone)}).`;
    const rows = bookingRows(d, 'pt');
    return { subject: title, html: layout({ title, intro, rows, cta: d.admin_url ? { url: d.admin_url, label: 'Abrir no painel' } : null, locale: 'pt' }), text: toText(title, intro, rows) };
  },
  admin_cancel_request(d) {
    const title = `Pedido de cancelamento ${d.reference}`;
    const intro = `O cliente <strong>${esc(d.customer_name)}</strong> pediu o cancelamento desta reserva.${d.reason ? ` Motivo: ${esc(d.reason)}` : ''}`;
    const rows = bookingRows(d, 'pt');
    return { subject: title, html: layout({ title, intro, rows, cta: d.admin_url ? { url: d.admin_url, label: 'Abrir no painel' } : null, locale: 'pt' }), text: toText(title, intro, rows) };
  },
  admin_new_request(d) {
    const title = `Novo pedido de tour personalizado ${d.reference}`;
    const intro = `De <strong>${esc(d.name)}</strong> (${esc(d.email)}, ${esc(d.phone)}).`;
    const rows = [['Destino', d.destination || '—'], ['Datas', [d.date_from, d.date_to].filter(Boolean).join(' → ') || 'Flexível'], ['Participantes', `${d.adults} adultos, ${d.children} crianças`], ['Orçamento', d.budget ? fmtMoney(d.budget, d.budget_currency || 'MZN') : '—']];
    return { subject: title, html: layout({ title, intro, rows, cta: d.admin_url ? { url: d.admin_url, label: 'Abrir no painel' } : null, locale: 'pt' }), text: toText(title, intro, rows) };
  },
  admin_quote_accepted(d) {
    const title = `Cotação aceite ${d.reference}`;
    const intro = `${esc(d.name)} aceitou a cotação de ${esc(fmtMoney(d.total, d.currency))}.`;
    return { subject: title, html: layout({ title, intro, cta: d.admin_url ? { url: d.admin_url, label: 'Abrir no painel' } : null, locale: 'pt' }), text: toText(title, intro, []) };
  },
};

export function renderTemplate(name, locale, data) {
  const fn = T[name];
  if (!fn) throw new Error(`Unknown e-mail template: ${name}`);
  return fn(data, locale === 'en' ? 'en' : 'pt');
}

export const TEMPLATE_NAMES = Object.keys(T);
