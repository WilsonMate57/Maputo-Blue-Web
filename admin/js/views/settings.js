// Settings: booking policy, loyalty programme, notifications.
import { $, CATEGORY_LABELS, busy, esc, formValues, get, put } from '../core.js';

export default async function settings(main) {
  const [s, cats] = await Promise.all([get('/admin/settings'), get('/admin/categories')]);
  const b = s.booking, l = s.loyalty, n = s.notifications;
  const allCats = [...cats.tour, ...cats.accommodation];

  main.innerHTML = `
    <div class="cols cols--even">
      <form class="card" id="f-booking" novalidate><div class="card__head"><h2>Reservas</h2></div><div class="card__body">
        <label class="check"><input type="checkbox" name="pending_holds_capacity"${b.pending_holds_capacity ? ' checked' : ''}> Pedidos pendentes reservam capacidade</label>
        <div class="grid grid--2" style="margin-top:12px;">
          <label class="field"><span>Duração do bloqueio (horas)</span><input type="number" name="pending_hold_hours" min="1" max="720" value="${b.pending_hold_hours}"><span class="field__hint">Depois disto o lugar é libertado se o pedido não for confirmado.</span></label>
          <label class="field"><span>Antecedência mínima (horas)</span><input type="number" name="min_lead_hours" min="0" max="720" value="${b.min_lead_hours}"></label>
          <label class="field"><span>Reservas até (dias)</span><input type="number" name="max_advance_days" min="1" max="1095" value="${b.max_advance_days}"></label>
        </div>
        <label class="check" style="margin-top:12px;"><input type="checkbox" name="auto_complete"${b.auto_complete ? ' checked' : ''}> Marcar reservas confirmadas como concluídas depois da data</label>
        <div class="form-actions"><button type="submit" class="btn btn--secondary">Guardar</button></div>
      </div></form>

      <form class="card" id="f-loyalty" novalidate><div class="card__head"><h2>Programa de fidelização</h2></div><div class="card__body">
        <label class="check"><input type="checkbox" name="enabled"${l.enabled ? ' checked' : ''}> Programa activo</label>
        <div class="grid grid--2" style="margin-top:12px;">
          <label class="field"><span>Viagens concluídas necessárias</span><input type="number" name="min_completed_bookings" min="1" max="100" value="${l.min_completed_bookings}"></label>
          <label class="field"><span>Janela (meses)</span><input type="number" name="window_months" min="1" max="120" value="${l.window_months ?? ''}"><span class="field__hint">Vazio = sem limite de tempo.</span></label>
          <label class="field"><span>Tipo de desconto</span><select name="kind"><option value="percent"${l.kind === 'percent' ? ' selected' : ''}>Percentagem</option><option value="fixed"${l.kind === 'fixed' ? ' selected' : ''}>Valor fixo</option></select></label>
          <label class="field"><span>Valor</span><input type="number" name="value" min="0" step="0.01" value="${l.value}"></label>
          <label class="field"><span>Desconto máximo</span><input type="number" name="max_discount" min="0" value="${l.max_discount ?? ''}"></label>
        </div>
        <label class="check" style="margin-top:12px;"><input type="checkbox" name="combinable_with_promotions"${l.combinable_with_promotions ? ' checked' : ''}> Acumulável com promoções</label>
        <label class="check" style="margin-top:6px;"><input type="checkbox" name="require_verified_email"${l.require_verified_email !== false ? ' checked' : ''}> Exigir e-mail confirmado (recomendado)</label>
        <fieldset class="field" style="border:0;padding:0;margin:14px 0 0;"><span>Categorias elegíveis <small>(nenhuma = todas)</small></span>
          <div class="chips">${allCats.map(k => `<label class="check"><input type="checkbox" name="categories" data-multi value="${k}"${l.categories && l.categories.includes(k) ? ' checked' : ''}>${esc(CATEGORY_LABELS[k] || k)}</label>`).join('')}</div></fieldset>
        <div class="form-actions"><button type="submit" class="btn btn--secondary">Guardar</button></div>
      </div></form>

      <form class="card" id="f-notifications" novalidate><div class="card__head"><h2>Notificações</h2></div><div class="card__body">
        <label class="field"><span>E-mails da equipa <small>(um por linha)</small></span><textarea name="admin_emails" rows="3">${esc((n.admin_emails || []).join('\n'))}</textarea>
          <span class="field__hint">Recebem avisos de novos pedidos, cancelamentos e cotações aceites.</span></label>
        <label class="field" style="margin-top:12px;"><span>Lembrete ao cliente (dias antes da viagem)</span><input type="number" name="reminder_days_before" min="0" max="30" value="${n.reminder_days_before ?? 2}"><span class="field__hint">0 = não enviar lembretes.</span></label>
        <div class="form-actions"><button type="submit" class="btn btn--secondary">Guardar</button></div>
      </div></form>

      <div class="card"><div class="card__head"><h2>E-mail</h2></div><div class="card__body">
        ${s.mail_configured ? `<p class="alert alert--success" style="margin:0;">Configurado. Remetente: ${esc(s.mail_from)}</p>`
          : '<p class="alert alert--warn" style="margin:0;">Não configurado. Defina RESEND_API_KEY e MAIL_FROM no ficheiro server/.env do servidor e reinicie o serviço (ver docs/IMPLANTACAO.md).</p>'}
      </div></div>
    </div>`;

  const wire = (id, key, map) => $(id, main).addEventListener('submit', async e => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    try { await busy(e.currentTarget.querySelector('[type=submit]'), () => put(`/admin/settings/${key}`, map(v)), 'Definições guardadas.'); } catch { /* toast */ }
  });
  wire('#f-booking', 'booking', v => v);
  wire('#f-loyalty', 'loyalty', v => ({ ...v, categories: v.categories.length ? v.categories : null }));
  wire('#f-notifications', 'notifications', v => ({ admin_emails: v.admin_emails.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean), reminder_days_before: v.reminder_days_before ?? 0 }));
}
