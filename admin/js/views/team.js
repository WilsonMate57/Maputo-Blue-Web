// Team accounts (super-administrator only): add a member, change their level,
// resend the invitation, disable or remove access.
import { $, $$, badge, busy, confirmAction, dateTime, esc, get, modal, patch, post, toast } from '../core.js';

const LEVELS = `
  <ul class="list-plain small">
    <li><span>${badge('admin')}</span>Tudo no painel, menos a gestão da equipa.</li>
    <li><span>${badge('manager')}</span>Reservas, disponibilidade, pacotes, facturas e clientes (só consulta e notas).</li>
  </ul>`;

const roleSelect = (value = 'manager') => `<select name="role">
  <option value="manager"${value === 'manager' ? ' selected' : ''}>Gestor</option>
  <option value="admin"${value === 'admin' ? ' selected' : ''}>Administrador</option></select>`;

export default async function team(main, _params, { user: me }) {
  main.innerHTML = `
    <div class="page-head"><p class="muted" style="margin:0;max-width:720px;">Contas de quem trabalha no painel. Cada pessoa recebe um e-mail para escolher a sua própria palavra-passe: ninguém mais a fica a conhecer.</p>
      <div class="page-head__actions"><button type="button" class="btn btn--primary" id="new"><i class='bx bx-user-plus'></i>Adicionar membro</button></div></div>
    <div class="stack">
      <div class="card" id="list"></div>
      <div class="card"><div class="card__head"><h2>Níveis de acesso</h2></div><div class="card__body">${LEVELS}
        <p class="muted small" style="margin:10px 0 0;">Só o superadministrador cria contas e muda níveis. Ao mudar o nível ou desactivar uma conta, as sessões abertas dessa pessoa terminam.</p></div></div>
    </div>`;

  async function load() {
    const { items } = await get('/admin/team');
    const box = $('#list', main);
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Nome</th><th>Nível</th><th>Estado</th><th>Último acesso</th><th></th></tr></thead><tbody>
      ${items.map(u => {
        const locked = u.role === 'superadmin' || u.id === me.id;
        const state = u.disabled_at ? '<span class="badge badge--disabled">Desactivada</span>'
          : u.invite_pending ? '<span class="badge badge--pending">Convite por aceitar</span>' : '<span class="badge badge--confirmed badge--plain">Activa</span>';
        return `<tr><td><span class="t-strong">${esc(u.name)}</span><span class="t-sub">${esc(u.email)}</span></td>
          <td>${badge(u.role)}</td><td>${state}</td><td class="muted nowrap">${u.last_sign_in ? dateTime(u.last_sign_in) : '—'}</td>
          <td class="nowrap">${locked ? '' : `
            <button type="button" class="icon-btn" data-act="role" data-id="${u.id}" aria-label="Mudar nível" title="Mudar nível"><i class='bx bx-shield-quarter'></i></button>
            ${u.disabled_at ? '' : `<button type="button" class="icon-btn" data-act="invite" data-id="${u.id}" aria-label="Enviar novo convite" title="Enviar novo convite (também serve para repor a palavra-passe)"><i class='bx bx-envelope'></i></button>`}
            <button type="button" class="icon-btn" data-act="disable" data-id="${u.id}" aria-label="${u.disabled_at ? 'Reactivar' : 'Desactivar'}" title="${u.disabled_at ? 'Reactivar' : 'Desactivar'}"><i class='bx ${u.disabled_at ? 'bx-user-check' : 'bx-user-x'}'></i></button>
            <button type="button" class="icon-btn" data-act="remove" data-id="${u.id}" aria-label="Retirar da equipa" title="Retirar da equipa"><i class='bx bx-trash'></i></button>`}</td></tr>`;
      }).join('')}</tbody></table></div>`;

    $$('[data-act]', box).forEach(b => b.addEventListener('click', async () => {
      const u = items.find(x => x.id === b.dataset.id);
      try {
        if (b.dataset.act === 'role') {
          const r = await modal({
            title: `Nível de ${u.name}`,
            body: `<label class="field"><span>Nível</span>${roleSelect(u.role)}</label>${LEVELS}`,
            actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar', kind: 'primary', value: 'ok', submit: true,
              run: v => patch(`/admin/team/${u.id}`, { role: v.role }) }],
          });
          if (r) { toast('Nível actualizado.'); load(); }
        } else if (b.dataset.act === 'invite') {
          await busy(b, () => post(`/admin/team/${u.id}/invite`), `Convite enviado para ${u.email}.`);
          load();
        } else if (b.dataset.act === 'disable') {
          const dis = !u.disabled_at;
          if (dis && !(await confirmAction({ title: 'Desactivar conta', text: `<strong>${esc(u.name)}</strong> deixa de conseguir entrar no painel e as sessões abertas terminam.`, confirm: 'Desactivar', kind: 'danger-solid' }))) return;
          await busy(b, () => patch(`/admin/team/${u.id}`, { disabled: dis }), dis ? 'Conta desactivada.' : 'Conta reactivada.');
          load();
        } else if (b.dataset.act === 'remove') {
          if (!(await confirmAction({ title: 'Retirar da equipa', text: `<strong>${esc(u.name)}</strong> perde o acesso ao painel. A conta passa a ser de cliente e o histórico mantém-se.`, confirm: 'Retirar acesso', kind: 'danger-solid' }))) return;
          await busy(b, () => patch(`/admin/team/${u.id}`, { role: 'customer' }), 'Acesso retirado.');
          load();
        }
      } catch { /* toast */ }
    }));
  }

  $('#new', main).addEventListener('click', async () => {
    let created = null;
    const r = await modal({
      title: 'Adicionar membro da equipa',
      body: `<div class="grid grid--2">
          <label class="field"><span>Nome</span><input name="name" required minlength="2" maxlength="120" autocomplete="off"></label>
          <label class="field"><span>E-mail</span><input type="email" name="email" required maxlength="200" autocomplete="off"></label>
          <label class="field"><span>Nível</span>${roleSelect()}</label>
        </div>${LEVELS}`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Criar e enviar convite', kind: 'primary', value: 'ok', submit: true,
        validate: v => (v.name.trim().length < 2 ? 'Indique o nome.' : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim()) ? 'Indique um e-mail válido.' : null),
        run: async v => { created = await post('/admin/team', { name: v.name.trim(), email: v.email.trim(), role: v.role }); } }],
    });
    if (!r || !created) return;
    toast(created.promoted
      ? `${created.user.email} já tinha conta de cliente: passou a ter acesso ao painel com a palavra-passe que já usa.`
      : `Convite enviado para ${created.user.email}.`);
    load();
  });

  await load();
}
