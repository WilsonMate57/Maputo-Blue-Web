// On-screen invoice document (same content and order as the PDF).
import { date, esc, money } from './core.js';

const cents = n => Math.round(Number(n || 0) * 100);

export function invoiceDoc(inv, { status = '', paid = inv.amount_paid || 0 } = {}) {
  const iss = inv.issuer || {}, c = inv.customer || {}, b = inv.booking_snapshot || {};
  const balance = (cents(inv.total) - cents(paid)) / 100;
  return `
    <article class="doc" aria-label="Pré-visualização da factura">
      <header class="doc__head">
        <div class="doc__issuer"><img src="../logo.webp" alt="">
          <div><strong>${esc(iss.name || 'Maputo Blue')}</strong>
            <p>${esc([iss.legal_name, iss.address, iss.phone, iss.email, iss.nuit ? `NUIT: ${iss.nuit}` : ''].filter(Boolean).join('\n'))}</p></div></div>
        <div class="doc__title"><h3>Factura</h3><div class="doc__no">${esc(inv.number || 'Rascunho — número atribuído ao emitir')}</div>
          <p class="muted small" style="margin:6px 0 0;">Emissão: ${date(inv.issue_date)}${inv.due_date ? ` · Vencimento: ${date(inv.due_date)}` : ''}</p>
          ${status ? `<div style="margin-top:8px;">${status}</div>` : ''}</div>
      </header>
      <div class="doc__parties">
        <div><span class="eyebrow">Facturado a</span><p class="t-strong" style="font-size:15px;color:var(--text-strong);">${esc(c.name || '—')}</p>
          <p class="muted">${esc([c.address, c.country, c.email, c.nuit ? `NUIT: ${c.nuit}` : ''].filter(Boolean).join(' · '))}</p></div>
        <div><span class="eyebrow">Serviço</span><p class="t-strong" style="color:var(--text-strong);">${esc(b.title || '')}</p>
          <p class="muted">Reserva ${esc(b.reference || '')} · ${date(b.start_date)}${b.end_date && b.end_date !== b.start_date ? ` – ${date(b.end_date)}` : ''} · ${b.adults ?? 0} adulto(s)${b.children ? `, ${b.children} criança(s)` : ''}</p></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Descrição</th><th class="right">Qtd.</th><th class="right">Preço unit.</th><th class="right">Valor</th></tr></thead>
        <tbody>${(inv.lines || []).map(l => `<tr><td>${esc(l.description)}${l.reason ? `<span class="t-sub">${esc(l.reason)}</span>` : ''}</td><td class="right mono">${l.quantity}</td>
          <td class="right mono">${l.unit_price === null ? '—' : money(l.unit_price, inv.currency)}</td><td class="right mono">${money(l.amount, inv.currency)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="doc__totals">
        <div><span>Subtotal</span><span class="mono">${money(inv.subtotal, inv.currency)}</span></div>
        ${(inv.discounts || []).map(d => `<div style="color:var(--success);"><span>Desconto: ${esc(d.description)}</span><span class="mono">− ${money(d.amount, inv.currency)}</span></div>`).join('')}
        <div class="is-total"><span>Total</span><span class="mono">${money(inv.total, inv.currency)}</span></div>
        ${inv.tax && inv.tax.enabled ? `<div class="muted small"><span>${esc(inv.tax.label)} (${inv.tax.rate}%) incluído</span><span class="mono">${money(inv.tax_total, inv.currency)}</span></div>` : ''}
        <div><span>Pago</span><span class="mono">${money(paid, inv.currency)}</span></div>
        <div class="${balance > 0 ? 'is-due' : 'is-ok'}"><span>Saldo em dívida</span><span class="mono">${money(Math.max(balance, 0), inv.currency)}</span></div>
      </div>
      ${inv.payment_instructions ? `<p class="small" style="margin:16px 0 0;white-space:pre-line;"><strong>Instruções de pagamento</strong><br>${esc(inv.payment_instructions)}</p>` : ''}
      ${inv.notes ? `<p class="small" style="margin:12px 0 0;white-space:pre-line;"><strong>Observações</strong><br>${esc(inv.notes)}</p>` : ''}
    </article>`;
}
