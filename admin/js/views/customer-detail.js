// Customer detail: bookings, loyalty status & audited adjustments, notes, access.
import { $, badge, busy, confirmAction, date, dateTime, esc, get, modal, money, patch, post, toast } from '../core.js';

export default async function customerDetail(main, [id], { setTitle, user: me }) {
  async function load() {
    const d = await get(`/admin/customers/${id}`);
    const u = d.user, l = d.loyalty;
    setTitle(u.name);
    const self = u.id === me.id;
    main.innerHTML = `
      <div class="page-head">
        <div><a class="link small" href="#/customers"><i class='bx bx-arrow-back'></i> Clientes</a>
          <h2 style="margin-top:4px;">${esc(u.name)} ${badge(u.role)} ${u.disabled_at ? '<span class="badge badge--disabled">Desactivada</span>' : ''}</h2>
          <p class="muted small" style="margin:4px 0 0;">${esc(u.email)} · registo em ${date(u.created_at)} · ${u.email_verified_at ? 'e-mail confirmado' : 'e-mail por confirmar'}</p></div>
        ${self ? '' : `<div class="status-actions">
          <button type="button" class="btn btn--ghost" id="role">${u.role === 'admin' ? 'Retirar acesso de administrador' : 'Tornar administrador'}</button>
          <button type="button" class="btn ${u.disabled_at ? 'btn--ghost' : 'btn--danger'}" id="disable">${u.disabled_at ? 'Reactivar conta' : 'Desactivar conta'}</button></div>`}
      </div>
      <div class="cols">
        <div class="card"><div class="card__head"><h2>Reservas</h2></div><div class="card__body table-wrap">
          ${d.bookings.length ? `<table class="table"><thead><tr><th>Referência</th><th>Experiência</th><th>Data</th><th class="right">Total</th><th>Estado</th></tr></thead><tbody>
            ${d.bookings.map(b => `<tr><td><a class="link mono" href="#/bookings/${b.id}">${esc(b.reference)}</a></td><td>${esc(b.package_title)}</td><td class="nowrap">${date(b.start_date)}</td>
              <td class="right mono">${money(b.total, b.currency)}</td><td>${badge(b.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="margin:0;">Sem reservas associadas.</p>'}
        </div></div>
        <div class="stack">
          <div class="card"><div class="card__head"><h2>Fidelização</h2><button type="button" class="btn btn--ghost btn--sm" id="adjust"><i class='bx bx-plus-circle'></i>Ajustar</button></div><div class="card__body">
            ${l.enabled ? `<p style="margin:0 0 6px;"><strong class="mono" style="font-size:20px;">${l.completed}</strong> de ${l.required} viagens concluídas ${l.eligible ? '<span class="badge badge--confirmed">Elegível</span>' : ''}</p>
              ${l.reason === 'email_not_verified' ? '<p class="muted small">Só conta depois de o cliente confirmar o e-mail.</p>' : ''}` : '<p class="muted" style="margin:0;">O programa de fidelização está desactivado (Definições).</p>'}
            ${d.adjustments.length ? `<ul class="list-plain" style="margin-top:8px;">${d.adjustments.map(a => `<li><span>${a.delta > 0 ? '+' : ''}${a.delta} · ${esc(a.reason)}<span class="t-sub">${esc(a.created_by_name || '')} · ${dateTime(a.created_at)}</span></span></li>`).join('')}</ul>` : ''}
          </div></div>
          <div class="card"><div class="card__head"><h2>Contacto</h2></div><div class="card__body"><ul class="list-plain">
            <li><a class="link" href="mailto:${esc(u.email)}">${esc(u.email)}</a></li>${u.phone ? `<li><a class="link" href="tel:${esc(u.phone)}">${esc(u.phone)}</a></li>` : ''}
            ${u.country ? `<li>${esc(u.country)}</li>` : ''}<li><span class="muted">Idioma</span>${u.locale === 'en' ? 'Inglês' : 'Português'}</li></ul></div></div>
          <div class="card"><div class="card__head"><h2>Notas internas</h2></div><div class="card__body">
            <form id="note-form"><label class="field"><textarea name="body" rows="3" maxlength="4000" required></textarea></label>
              <div class="form-actions"><button class="btn btn--secondary btn--sm" type="submit">Adicionar nota</button></div></form>
            ${d.notes.map(n => `<div class="note"><div style="white-space:pre-wrap;">${esc(n.body)}</div><div class="note__meta">${esc(n.author || '')} · ${dateTime(n.created_at)}</div></div>`).join('')}
          </div></div>
        </div>
      </div>`;

    $('#adjust', main).addEventListener('click', async () => {
      const r = await modal({
        title: 'Ajuste de fidelização',
        body: `<p class="muted">Adicione ou retire viagens concluídas que contam para a fidelização. Fica registado com o seu nome.</p>
          <div class="grid grid--2"><label class="field"><span>Viagens (+/−)</span><input type="number" name="delta" min="-100" max="100" required value="1"></label>
          <label class="field"><span>Motivo</span><input name="reason" required minlength="3" maxlength="500"></label></div>`,
        actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar', kind: 'primary', value: 'ok', submit: true,
          validate: v => (!v.delta ? 'Indique um número diferente de zero.' : v.reason.trim().length < 3 ? 'Indique o motivo.' : null),
          run: v => post(`/admin/customers/${u.id}/loyalty-adjustments`, { delta: v.delta, reason: v.reason.trim() }) }],
      });
      if (r) { toast('Ajuste registado.'); load(); }
    });
    $('#note-form', main).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget;
      if (!f.body.value.trim()) return;
      try { await busy(f.querySelector('button'), () => post(`/admin/customers/${u.id}/notes`, { body: f.body.value.trim() }), 'Nota adicionada.'); load(); } catch { /* toast */ }
    });
    if (!self) {
      $('#role', main).addEventListener('click', async e => {
        const toAdmin = u.role !== 'admin';
        if (!(await confirmAction({ title: toAdmin ? 'Dar acesso de administrador' : 'Retirar acesso de administrador',
          text: toAdmin ? `<strong>${esc(u.name)}</strong> passará a ter acesso total ao painel (reservas, preços, clientes). Continuar?` : `Retirar o acesso de administrador a <strong>${esc(u.name)}</strong>?`,
          confirm: toAdmin ? 'Dar acesso' : 'Retirar acesso', kind: 'danger-solid' }))) return;
        try { await busy(e.currentTarget, () => patch(`/admin/customers/${u.id}`, { role: toAdmin ? 'admin' : 'customer' }), 'Acesso actualizado.'); load(); } catch { /* toast */ }
      });
      $('#disable', main).addEventListener('click', async e => {
        const dis = !u.disabled_at;
        if (dis && !(await confirmAction({ title: 'Desactivar conta', text: 'A pessoa deixa de conseguir iniciar sessão e as sessões abertas terminam. As reservas mantêm-se.', confirm: 'Desactivar', kind: 'danger-solid' }))) return;
        try { await busy(e.currentTarget, () => patch(`/admin/customers/${u.id}`, { disabled: dis }), dis ? 'Conta desactivada.' : 'Conta reactivada.'); load(); } catch { /* toast */ }
      });
    }
  }
  await load();
}
