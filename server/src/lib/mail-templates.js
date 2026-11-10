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
        ${locale === 'en' ? 'You received this e-mail because of a request made on maputoblue.co.mz.' : 'Recebeu este e-mail devido a um pedido feito em maputoblue.co.mz.'}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const plain = html => String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

function toText(title, intro, rows, extra = '') {
  return [title, '', intro.replace(/<[^>]+>/g, ''), '', ...rows.map(([k, v]) => `${k}: ${v}`), extra ? '\n' + extra : ''].join('\n');
}

/** Company details of a request made on behalf of a company. */
function billingRows(b, L) {
  if (!b || !b.company_name) return [];
  const en = L === 'en';
  return [[en ? 'Company' : 'Empresa', b.company_name], ...(b.nuit ? [['NUIT', b.nuit]] : []),
    ...(b.address ? [[en ? 'Billing address' : 'Morada de facturação', b.address]] : [])];
}

/** Boarding needs the trip paid in full: say so wherever money is still missing. */
function payToBoard(d, L) {
  const en = L === 'en';
  const due = d.amount_due > 0 ? ` ${en ? 'Outstanding' : 'Em falta'}: <strong>${esc(fmtMoney(d.amount_due, d.currency))}</strong>.` : '';
  return `<p style="background:#FEF2F2;border-left:3px solid #B91C1C;padding:12px 14px;margin:16px 0 0;color:#7F1D1D;">${en
    ? `<strong>Boarding requires full payment.</strong>${due} Your ticket with its QR code is e-mailed as soon as the payment is confirmed. Booking documents sent before that are not tickets.`
    : `<strong>Só pode embarcar com a viagem paga na totalidade.</strong>${due} O bilhete com código QR é enviado por e-mail assim que o pagamento for confirmado. Os documentos recebidos antes disso não são bilhetes.`}</p>`;
}

/** How to pay, as the company wrote it in Settings. */
function payBox(d, L) {
  if (!d.how_to_pay) return '';
  return `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px 16px;margin:16px 0 0;"><p style="margin:0 0 6px;font-weight:700;color:#0A2540;">${L === 'en' ? 'How to pay' : 'Como pagar'}</p><p style="margin:0;white-space:pre-line;">${esc(d.how_to_pay)}</p></div>`;
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
  rows.push(['Estado / Status', d.state === 'unpaid' ? (en ? 'Date available — awaiting payment' : 'Data disponível — a aguardar pagamento') : STATUS[L][d.status] || d.status]);
  return rows;
}

const T = {
  booking_received(d, L) {
    const en = L === 'en';
    const title = en ? 'We received your booking request' : 'Recebemos o seu pedido de reserva';
    const intro = en
      ? `Hello ${esc(d.customer_name)}, thank you for choosing Maputo Blue. Your request is <strong>pending</strong>: our team will check availability and confirm shortly. This is not a confirmation and <strong>not a ticket</strong>.`
      : `Olá ${esc(d.customer_name)}, obrigado por escolher a Maputo Blue. O seu pedido está <strong>pendente</strong>: a nossa equipa vai verificar a disponibilidade e confirmar em breve. Isto não é uma confirmação nem um <strong>bilhete</strong>.`;
    const rows = bookingRows(d, L);
    const body = payToBoard({ ...d, amount_due: 0 }, L);
    const cta = d.status_url ? { url: d.status_url, label: en ? 'Track your booking' : 'Acompanhar a reserva' } : null;
    return { subject: `${en ? 'Booking request' : 'Pedido de reserva'} ${d.reference} — Maputo Blue`, html: layout({ title, intro, rows, body, cta, locale: L }), text: toText(title, intro, rows, [d.status_url, plain(body)].filter(Boolean).join('\n\n')) };
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
    // Confirmed but not paid: the date is held, the booking is not complete yet
    if (d.event === 'confirmed' && d.state === 'unpaid') {
      map.confirmed = en
        ? ['Your date is available — complete your booking with payment', `good news: <strong>the date you chose is available</strong> and we are holding your place. <strong>Your booking is not complete yet.</strong> Please proceed with payment of the service requested to confirm your booking.`]
        : ['A data está disponível — conclua a reserva com o pagamento', `boas notícias: <strong>a data que escolheu está disponível</strong> e guardámos o seu lugar. <strong>A reserva ainda não está concluída</strong>: para a concluir, faça o pagamento de <strong>${esc(fmtMoney(d.amount_due, d.currency))}</strong>.`];
    } else if (d.event === 'confirmed' && d.state === 'boarding') {
      map.confirmed = en
        ? ['Your booking is complete', 'your booking is <strong>confirmed and paid</strong>. Your ticket with its QR code is attached: please show it at the meeting point. We look forward to welcoming you.']
        : ['A sua reserva está concluída', 'a sua reserva está <strong>confirmada e paga</strong>. Segue em anexo o bilhete com código QR: apresente-o no ponto de encontro. Aguardamos por si.'];
    }
    const [title, msg] = map[d.event] || map.updated;
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.customer_name)}, ${msg}`;
    const rows = bookingRows(d, L);
    const unpaid = d.state === 'unpaid' && (d.event === 'confirmed' || d.event === 'updated');
    const stop = unpaid ? `<p style="background:#FEF2F2;border-left:3px solid #B91C1C;padding:12px 14px;margin:16px 0 0;color:#7F1D1D;">${en
      ? '<strong>Please do not go to the meeting point yet.</strong> You can only board with the ticket and its QR code, which we e-mail as soon as the full payment is confirmed.'
      : '<strong>Não se dirija ainda ao ponto de partida.</strong> Só pode embarcar com o bilhete com código QR, que enviamos por e-mail assim que o pagamento total for confirmado.'}</p>` : '';
    const body = (d.message ? `<p style="background:#F8FAFC;border-left:3px solid #00bcd4;padding:12px 14px;margin:0;">${esc(d.message)}</p>` : '')
      + (unpaid ? payBox(d, L) + stop : '');
    const cta = d.status_url ? { url: d.status_url, label: en ? 'View booking' : 'Ver reserva' } : null;
    return { subject: `${title} — ${d.reference}`, html: layout({ title, intro, rows, body, cta, locale: L }), text: toText(title, intro, rows, [d.message, unpaid ? plain(payBox(d, L) + stop) : ''].filter(Boolean).join('\n\n')) };
  },
  booking_ticket(d, L) {
    const en = L === 'en';
    const ticket = d.state === 'boarding';
    const title = ticket ? (en ? 'Your ticket' : 'O seu bilhete') : (en ? 'Your booking document' : 'O seu documento de reserva');
    const statusNote = ticket
      ? (en ? 'Your booking is <strong>confirmed and ready for boarding</strong>. Please show the QR code at the meeting point (printed or on your phone).' : 'A sua reserva está <strong>confirmada e pronta para o embarque</strong>. Apresente o código QR no ponto de encontro (impresso ou no telemóvel).')
      : d.state === 'unpaid' || d.status === 'pending'
        ? (en ? 'This document is <strong>not a ticket</strong> and does not give access to boarding.' : 'Este documento <strong>não é um bilhete</strong> e não dá acesso ao embarque.')
        : (en ? 'Please check the current status of your booking in the attached document.' : 'Consulte o estado actual da sua reserva no documento em anexo.');
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.customer_name)}, ${en ? 'attached is the document for booking' : 'em anexo segue o documento da reserva'} <strong>${esc(d.reference)}</strong>. ${statusNote}`;
    const body = d.state === 'unpaid' || d.status === 'pending' ? payToBoard({ ...d, amount_due: d.state === 'unpaid' ? d.amount_due : 0 }, L) : '';
    return { subject: `${title} ${d.reference} — Maputo Blue`, html: layout({ title, intro, body, locale: L,
      footerNote: en ? 'This document is not a receipt or a tax document.' : 'Este documento não é um recibo nem um documento fiscal.' }), text: toText(title, intro, [], plain(body)) };
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
      ? 'we have verified your payment. Your invoice is now <strong>PAID</strong>. The updated invoice is attached, together with your ticket when the booking is confirmed.'
      : 'confirmámos o seu pagamento. A sua factura está agora <strong>PAGA</strong>. Seguem em anexo a factura actualizada e, com a reserva confirmada, o seu bilhete.'}`;
    const rows = [[en ? 'Invoice' : 'Factura', d.number], [en ? 'Booking' : 'Reserva', d.reference], [en ? 'Amount paid' : 'Valor pago', fmtMoney(d.amount_paid, d.currency)]];
    return { subject: `${title} — Maputo Blue`, html: layout({ title, intro, rows, locale: L }), text: toText(title, intro, rows) };
  },
  trip_reminder(d, L) {
    const en = L === 'en';
    const title = en ? 'Your trip is coming up' : 'A sua viagem está a chegar';
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.customer_name)}, ${en ? 'a friendly reminder of your upcoming experience with Maputo Blue.' : 'um lembrete da sua próxima experiência com a Maputo Blue.'}`;
    const rows = bookingRows(d, L);
    if (d.meeting_point) rows.push([en ? 'Meeting point' : 'Ponto de encontro', d.meeting_point]);
    const body = d.state === 'unpaid' ? payToBoard(d, L) + payBox(d, L) : '';
    return { subject: `${title} — ${d.reference}`, html: layout({ title, intro, rows, body, locale: L }), text: toText(title, intro, rows, plain(body)) };
  },
  request_received(d, L) {
    const en = L === 'en';
    const title = en ? 'We received your quote request' : 'Recebemos o seu pedido de cotação';
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.name)}, ${en ? 'our team will review your request and send you a personalised quotation. Nothing is booked or charged yet.' : 'a nossa equipa vai analisar o seu pedido e enviar-lhe uma cotação personalizada. Nada foi reservado nem cobrado.'}`;
    const rows = [[en ? 'Reference' : 'Referência', d.reference],
      ...(d.items || []).map(i => [en ? i.title_en : i.title, i.date ? fmtDate(i.date, L) : (en ? 'Trip dates' : 'Datas da viagem')]),
      ...(d.destination ? [[en ? 'Destination' : 'Destino', d.destination]] : []),
      [en ? 'Dates' : 'Datas', [d.date_from, d.date_to].filter(Boolean).map(x => fmtDate(x, L)).join(' → ') || (en ? 'Flexible' : 'Flexíveis')],
      [en ? 'Guests' : 'Participantes', `${d.adults} + ${d.children}`],
      ...billingRows(d.billing, L)];
    return { subject: `${title} — ${d.reference}`, html: layout({ title, intro, rows, locale: L }), text: toText(title, intro, rows) };
  },
  quote_issued(d, L) {
    const en = L === 'en';
    const title = en ? 'Your personalised quotation' : 'A sua cotação personalizada';
    const intro = `${en ? 'Hello' : 'Olá'} ${esc(d.name)}, ${en ? 'please find your quotation below. It is valid until' : 'segue a sua cotação. É válida até'} <strong>${esc(fmtDate(d.valid_until, L))}</strong>.`;
    const rows = (d.items || []).map(i => [`${i.description}${Number(i.quantity) !== 1 ? ` × ${i.quantity}` : ''}`, fmtMoney(i.amount ?? i.quantity * i.unit_price, d.currency)]);
    if (Number(d.global_discount)) rows.push([en ? 'Discount' : 'Desconto', `- ${fmtMoney(d.global_discount, d.currency)}`]);
    if (Number(d.fees_total)) rows.push([en ? 'Additional fees' : 'Taxas adicionais', fmtMoney(d.fees_total, d.currency)]);
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
  // ── Team (always Portuguese) ──
  staff_invite(d) {
    const title = 'Acesso ao painel Maputo Blue';
    const intro = `Olá ${esc(d.name)}, foi criada para si uma conta de <strong>${esc(d.role_label)}</strong> no painel de gestão da Maputo Blue. Defina a sua palavra-passe no botão abaixo. O link é válido por 72 horas. Depois, entre em ${esc(d.admin_url)} com este e-mail.`;
    return { subject: title, html: layout({ title, intro, cta: { url: d.url, label: 'Definir palavra-passe' }, locale: 'pt' }), text: toText(title, intro, [], d.url) };
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
    const title = `Novo pedido de cotação ${d.reference}`;
    const intro = `De <strong>${esc(d.name)}</strong> (${esc(d.email)}, ${esc(d.phone)}).`;
    const rows = [...(d.items || []).map(i => [i.title, i.date ? fmtDate(i.date, 'pt') : 'datas da viagem']), ['Destino / ideias', [d.destination, d.activities].filter(Boolean).join(' · ') || '—'], ['Datas', [d.date_from, d.date_to].filter(Boolean).join(' → ') || 'Flexível'], ['Participantes', `${d.adults} adultos, ${d.children} crianças`], ['Orçamento', d.budget ? fmtMoney(d.budget, d.budget_currency || 'MZN') : '—'], ...billingRows(d.billing, 'pt')];
    return { subject: title, html: layout({ title, intro, rows, cta: d.admin_url ? { url: d.admin_url, label: 'Abrir no painel' } : null, locale: 'pt' }), text: toText(title, intro, rows) };
  },
  admin_quote_accepted(d) {
    const title = `Cotação aceite ${d.reference}`;
    const intro = `${esc(d.name)} aceitou a cotação de ${esc(fmtMoney(d.total, d.currency))}.`;
    return { subject: title, html: layout({ title, intro, cta: d.admin_url ? { url: d.admin_url, label: 'Abrir no painel' } : null, locale: 'pt' }), text: toText(title, intro, []) };
  },
  admin_quote_declined(d) {
    const title = `Cotação recusada ${d.reference}`;
    const intro = `${esc(d.name)} recusou a cotação de ${esc(fmtMoney(d.total, d.currency))}.`;
    const body = d.message ? `<p>Motivo: ${esc(d.message)}</p>` : '';
    return { subject: title, html: layout({ title, intro, body, cta: { url: d.admin_url, label: 'Abrir no painel' }, locale: 'pt' }), text: toText(title, intro, [], d.message || '') };
  },
  admin_chat(d) {
    const title = `Live Chat: ${d.name} aguarda resposta`;
    const intro = `Há uma conversa no site sem resposta (${esc(d.reference)}).`;
    const rows = [['Visitante', d.name], ['E-mail', d.email], ['Telefone', d.phone || '—'], ['Assunto', d.subject]];
    const body = `<p>${esc(d.message)}</p>`;
    return { subject: title, html: layout({ title, intro, rows, body, cta: { url: d.admin_url, label: 'Abrir a conversa' }, locale: 'pt' }), text: toText(title, intro, rows, `${d.message}\n${d.admin_url}`) };
  },
  chat_reply(d, L) {
    const en = L === 'en';
    const title = en ? 'You have a reply from Maputo Blue' : 'Tem uma resposta da Maputo Blue';
    const intro = en ? `Hello ${esc(d.name)}, our team answered your message on the website.` : `Olá ${esc(d.name)}, a nossa equipa respondeu à sua mensagem no site.`;
    const body = d.messages.map(m => `<p><strong>${esc(m.author || 'Maputo Blue')}:</strong><br>${esc(m.body).replace(/\n/g, '<br>')}</p>`).join('');
    const footerNote = en ? 'To continue, open the website on the same device or simply reply to this e-mail.' : 'Para continuar, abra o site no mesmo dispositivo ou responda a este e-mail.';
    const plain = d.messages.map(m => `${m.author || 'Maputo Blue'}: ${m.body}`).join('\n\n');
    return { subject: `${title} (${d.reference})`, html: layout({ title, intro, body, cta: { url: d.site_url, label: en ? 'Open the website' : 'Abrir o site' }, footerNote, locale: L }), text: toText(title, intro, [], plain) };
  },
  admin_quote_revision(d) {
    const title = `Alteração pedida na cotação ${d.reference}`;
    const intro = `${esc(d.name)} pediu alterações à cotação de ${esc(fmtMoney(d.total, d.currency))}.`;
    const body = `<p>${esc(d.message)}</p>`;
    return { subject: title, html: layout({ title, intro, body, cta: { url: d.admin_url, label: 'Abrir no painel' }, locale: 'pt' }), text: toText(title, intro, [], d.message) };
  },
};

export function renderTemplate(name, locale, data) {
  const fn = T[name];
  if (!fn) throw new Error(`Unknown e-mail template: ${name}`);
  return fn(data, locale === 'en' ? 'en' : 'pt');
}

export const TEMPLATE_NAMES = Object.keys(T);
