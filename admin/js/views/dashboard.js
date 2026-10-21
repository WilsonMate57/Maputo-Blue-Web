// Dashboard: KPIs, money (confirmed vs estimated vs received), attention items,
// upcoming departures/stays, popular packages, limited days, recent activity.
import { $, addDays, badge, date, dateTime, esc, get, linkRows, money, qs, today } from '../core.js';

const ACTIONS = {
  created: 'Pedido criado', status_changed: 'Estado alterado', updated: 'Reserva editada', payment_recorded: 'Pagamento registado',
  cancel_requested: 'Cancelamento pedido', email_resent: 'E-mail reenviado',
};

export default async function dashboard(main) {
  const state = { from: addDays(today(), -30), to: today(), package_id: '' };
  const packages = await get('/admin/packages');

  main.innerHTML = `
    <div class="card" style="margin-bottom:18px;">
      <form class="filters" id="dash-filters">
        <label class="field"><span>De</span><input type="date" name="from" value="${state.from}"></label>
        <label class="field"><span>Até</span><input type="date" name="to" value="${state.to}"></label>
        <label class="field" style="flex:2 1 260px;"><span>Pacote</span><select name="package_id"><option value="">Todos os pacotes</option>
          ${packages.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select></label>
        <div class="chips" role="group" aria-label="Períodos rápidos">
          <button type="button" class="chip" data-range="7">7 dias</button>
          <button type="button" class="chip" data-range="30" aria-pressed="true">30 dias</button>
          <button type="button" class="chip" data-range="90">90 dias</button>
          <button type="button" class="chip" data-range="365">12 meses</button>
        </div>
      </form>
    </div>
    <div id="dash-body"></div>`;

  const form = $('#dash-filters', main);
  const body = $('#dash-body', main);

  async function load() {
    body.innerHTML = '<div class="card"><div class="card__body"><div class="skeleton"></div><div class="skeleton"></div></div></div>';
    const d = await get('/admin/dashboard' + qs(state));
    const c = d.counts;
    const a = d.attention;
    const moneyRows = d.money.length ? d.money.map(m => `
        <tr><td class="t-strong">${esc(m.currency)}</td>
          <td class="right mono">${money(m.confirmed_value, m.currency)}</td>
          <td class="right mono">${money(m.pending_value, m.currency)}</td>
          <td class="right mono">${money(m.received, m.currency)}</td>
          <td class="right mono">${money(m.outstanding, m.currency)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">Sem reservas no período.</td></tr>';
    const attention = [
      [a.pending, 'Pedidos pendentes por responder', '#/bookings?status=pending', 'bx-time-five'],
      [a.pending_hold_expired, 'Pendentes com bloqueio de 48h expirado', '#/bookings?status=pending', 'bx-error'],
      [a.cancel_requests, 'Pedidos de cancelamento', '#/bookings?cancel_requested=1', 'bx-x-circle'],
      [a.new_requests, 'Novos pedidos personalizados', '#/requests', 'bx-map-alt'],
      [a.failed_mail, 'E-mails que falharam', '#/mail', 'bx-envelope'],
    ].filter(x => x[0] > 0);

    body.innerHTML = `
      <div class="kpis">
        <div class="card kpi"><div class="kpi__label"><i class='bx bx-calendar'></i>Reservas no período</div><div class="kpi__value">${c.total}</div><div class="kpi__sub">pedidos criados</div></div>
        <div class="card kpi kpi--accent"><div class="kpi__label">Pendentes</div><div class="kpi__value">${c.pending}</div><div class="kpi__sub">à espera de resposta</div></div>
        <div class="card kpi kpi--green"><div class="kpi__label">Confirmadas</div><div class="kpi__value">${c.confirmed}</div><div class="kpi__sub">+ ${c.completed} concluídas</div></div>
        <div class="card kpi kpi--red"><div class="kpi__label">Canceladas / rejeitadas</div><div class="kpi__value">${c.cancelled + c.rejected}</div><div class="kpi__sub">${c.cancelled} canceladas · ${c.rejected} rejeitadas</div></div>
      </div>

      <div class="cols">
        <div class="stack">
          <div class="card">
            <div class="card__head"><h2>Valores das reservas</h2><span class="muted small">pelo dia em que o pedido foi criado</span></div>
            <div class="card__body table-wrap">
              <table class="table"><thead><tr><th>Moeda</th><th class="right" title="Reservas confirmadas e concluídas">Valor confirmado</th>
                <th class="right" title="Pedidos pendentes: ainda não é receita">Estimado (pendentes)</th>
                <th class="right" title="Pagamentos registados manualmente">Recebido</th><th class="right">Por receber</th></tr></thead>
                <tbody>${moneyRows}</tbody></table>
              <p class="muted small" style="margin:10px 0 0;">“Recebido” só inclui pagamentos registados no painel. Os pedidos pendentes são uma estimativa e não representam receita.</p>
            </div>
          </div>

          <div class="card">
            <div class="card__head"><h2>Próximas partidas e estadias (14 dias)</h2><a class="link" href="#/bookings?status=confirmed,pending&sort=date_asc&from=${today()}">Ver todas</a></div>
            <div class="card__body table-wrap">${d.upcoming.length ? `
              <table class="table"><thead><tr><th>Data</th><th>Referência</th><th>Cliente</th><th>Experiência</th><th>Pessoas</th><th>Estado</th></tr></thead><tbody>
              ${d.upcoming.map(b => `<tr data-href="#/bookings/${b.id}"><td class="nowrap">${date(b.start_date)}${b.kind === 'accommodation' ? `<span class="t-sub">até ${date(b.end_date)}</span>` : ''}</td>
                <td class="t-strong mono">${esc(b.reference)}</td><td>${esc(b.customer_name)}</td><td>${esc(b.package_title)}</td>
                <td>${b.adults + b.children}</td><td>${badge(b.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nada agendado para os próximos 14 dias.</p>'}
            </div>
          </div>

          <div class="card">
            <div class="card__head"><h2>Actividade recente</h2></div>
            <div class="card__body"><ul class="timeline">${d.recent.map(r => `
              <li><strong>${esc(ACTIONS[r.action] || r.action)}</strong> ${r.reference ? `· <a class="link" href="#/bookings/${esc(r.entity_id)}">${esc(r.reference)}</a>` : ''}
                ${r.data && r.data.to ? ` → ${badge(r.data.to)}` : ''}
                <time>${dateTime(r.at)} · ${esc(r.actor_name || (r.actor_type === 'guest' ? 'Cliente (sem conta)' : r.actor_type === 'system' ? 'Sistema' : r.actor_type))}</time></li>`).join('') || '<li class="muted">Sem actividade.</li>'}
            </ul></div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card__head"><h2>Requer atenção</h2></div>
            <div class="card__body">${attention.length ? `<ul class="list-plain">${attention.map(([n, t, href, icon]) => `
              <li><a href="${href}" class="t-strong" style="display:flex;gap:8px;align-items:center;"><i class='bx ${icon}' style="color:var(--coral);font-size:18px;"></i>${t}</a><span class="badge badge--pending badge--plain">${n}</span></li>`).join('')}</ul>`
              : '<p class="muted" style="margin:0;"><i class="bx bx-check-circle" style="color:var(--success)"></i> Está tudo em dia.</p>'}</div>
          </div>

          <div class="card">
            <div class="card__head"><h2>Pacotes mais reservados</h2></div>
            <div class="card__body">${d.popular.length ? `<ul class="list-plain">${d.popular.map(p => `
              <li><span><span class="t-strong">${esc(p.title)}</span><span class="t-sub">${p.guests} pessoas</span></span><span class="mono">${p.bookings}</span></li>`).join('')}</ul>` : '<p class="muted">Sem dados no período.</p>'}</div>
          </div>

          <div class="card">
            <div class="card__head"><h2>Dias com pouca disponibilidade</h2></div>
            <div class="card__body">${d.limited.length ? `<ul class="list-plain">${d.limited.map(l => `
              <li><span><span class="t-strong">${date(l.day)}</span><span class="t-sub">${esc(l.package_id)}</span></span>
                <span class="badge ${l.capacity - l.used <= 0 ? 'badge--cancelled' : 'badge--pending'} badge--plain">${Math.max(l.capacity - l.used, 0)} / ${l.capacity}</span></li>`).join('')}</ul>`
              : '<p class="muted" style="margin:0;">Nenhum dia com capacidade limitada nos próximos 30 dias.</p>'}</div>
          </div>
        </div>
      </div>`;
    linkRows(body);
  }

  form.addEventListener('change', e => {
    if (e.target.name) state[e.target.name] = e.target.value;
    form.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
    load();
  });
  form.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
    form.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
    state.to = today();
    state.from = addDays(state.to, -Number(chip.dataset.range));
    form.from.value = state.from; form.to.value = state.to;
    load();
  }));
  await load();
}
