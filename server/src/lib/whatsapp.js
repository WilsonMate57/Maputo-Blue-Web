// ─────────────────────────────────────────────────────────────────────────────
// whatsapp.js — Team alerts on WhatsApp through the Meta WhatsApp Cloud API,
// sent alongside the team e-mails (new booking, new quote request, quote
// accepted, cancellation request).
//
// Messages started by the business must use a template approved by Meta. One
// generic "utility" template with three body parameters covers every alert:
//   {{1}} title · {{2}} summary · {{3}} link to the admin panel
// (text to submit in docs/WHATSAPP.md). Booking alerts use a second template
// (WHATSAPP_TEMPLATE_CHAT) with the same body plus a "Conversar com o cliente"
// URL button <site>/wa/{{1}} (forwards to wa.me), when the customer's number can be read.
// Same outbox pattern as mailer.js: alerts
// are enqueued inside the business transaction and delivered with retries, so
// a WhatsApp failure never affects a booking.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 6;

export const whatsappConfigured = cfg => !!(cfg.whatsapp && cfg.whatsapp.token && cfg.whatsapp.phoneNumberId);

/** "+258 84 712 1666" → "258847121666" (international format, digits only); null if invalid. */
export function normalizePhone(value) {
  const m = /^\+?(\d{8,15})$/.exec(String(value || '').replace(/[\s().-]/g, ''));
  return m ? m[1] : null;
}

/**
 * Customer number for a wa.me link, from what the customer typed (free text):
 * "+258 84…" / "00258 84…" as given; a 9-digit Mozambican mobile ("84 123 4567")
 * gets the 258 country code. Anything else (local numbers of other countries,
 * typos) → null, and the alert goes without the chat button.
 */
export function chatPhone(value) {
  const raw = String(value || '').replace(/[\s().-]/g, '');
  if (/^\+\d{8,15}$/.test(raw)) return raw.slice(1);
  if (/^00\d{8,15}$/.test(raw)) return raw.slice(2);
  if (/^8[2-7]\d{7}$/.test(raw)) return `258${raw}`;
  if (/^258\d{9}$/.test(raw)) return raw;
  return null;
}

// Alerts about a booking get the "Conversar com o cliente" button
const CHAT_TEMPLATES = new Set(['admin_new_booking', 'admin_cancel_request']);

const fmtMoney = (n, cur) => `${cur || 'MZN'} ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmtDate = d => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const people = (a, c) => [`${a} adulto${a === 1 ? '' : 's'}`, c ? `${c} criança${c === 1 ? '' : 's'}` : null].filter(Boolean).join(', ');
const customer = (name, phone) => `Cliente: ${[name, phone].filter(Boolean).join(', ')}`;

// Meta rejects parameters with new lines, tabs or more than four spaces in a row
const param = (value, max) => String(value ?? '').replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim().slice(0, max) || '—';

/** Template parameters [title, summary, link] for an alert, or null when the alert has no WhatsApp version. */
export function alertParams(template, d) {
  let title, summary;
  switch (template) {
    case 'admin_new_booking':
      title = `Nova reserva ${d.reference}`;
      summary = [d.package_title, d.option_name,
        d.end_date && d.end_date !== d.start_date ? `${fmtDate(d.start_date)} → ${fmtDate(d.end_date)}` : fmtDate(d.start_date),
        people(d.adults, d.children), fmtMoney(d.total, d.currency), customer(d.customer_name, d.customer_phone)];
      break;
    case 'admin_cancel_request':
      title = `Pedido de cancelamento ${d.reference}`;
      summary = [d.package_title, fmtDate(d.start_date), customer(d.customer_name, d.customer_phone), d.reason ? `Motivo: ${d.reason}` : null];
      break;
    case 'admin_new_request':
      title = `Novo pedido de cotação ${d.reference}`;
      summary = [(d.items || []).map(i => i.title).join(', ') || d.destination,
        [d.date_from, d.date_to].filter(Boolean).map(fmtDate).join(' → ') || 'datas flexíveis',
        people(d.adults, d.children), d.billing && d.billing.company_name ? `Empresa: ${d.billing.company_name}` : null,
        customer(d.name, d.phone)];
      break;
    case 'admin_quote_accepted':
      title = `Cotação aceite ${d.reference || ''}`.trim();
      summary = [`${d.name} aceitou a cotação de ${fmtMoney(d.total, d.currency)}`];
      break;
    case 'test':
      title = 'Mensagem de teste';
      summary = ['As notificações de WhatsApp do site estão a funcionar'];
      break;
    default:
      return null;
  }
  return [param(title, 120), param(summary.filter(Boolean).join(' · '), 700), param(d.admin_url, 300)];
}

/** Queue an alert for every team number in settings.notifications.admin_whatsapp. */
export async function enqueueAdminWhatsApp(db, { key, template, data }) {
  const { rows } = await db.query(`select value from settings where key = 'notifications'`);
  const phones = ((rows[0] && rows[0].value.admin_whatsapp) || []).map(normalizePhone).filter(Boolean);
  const params = phones.length ? alertParams(template, data) : null;
  if (!params) return 0;
  const chat = CHAT_TEMPLATES.has(template) ? chatPhone(data.customer_phone) : null;
  for (const phone of phones) {
    await db.query(
      `insert into whatsapp_outbox (idempotency_key, to_phone, template, params, chat_phone) values ($1,$2,$3,$4,$5)
       on conflict (idempotency_key) do nothing`,
      [`${key}:wa:${phone}`, phone, template, JSON.stringify(params), chat]);
  }
  return phones.length;
}

// Meta error codes worth retrying: rate limits, throughput and temporary failures
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 80007, 130429, 131000, 131016, 131056, 133004]);

/** Transport: Meta WhatsApp Cloud API (Graph API). */
export function cloudApiTransport(wa) {
  return async ({ to, params, chatPhone: chat }) => {
    if (!wa.token || !wa.phoneNumberId) {
      throw Object.assign(new Error('WhatsApp not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)'), { retryable: false });
    }
    const withButton = !!(chat && wa.templateChat);
    const components = [{ type: 'body', parameters: params.map(text => ({ type: 'text', text })) }];
    if (withButton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: chat }] });
    const res = await fetch(`https://graph.facebook.com/${wa.apiVersion}/${encodeURIComponent(wa.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${wa.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
        template: { name: withButton ? wa.templateChat : wa.template, language: { code: wa.language }, components },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      const e = body.error || {};
      const err = new Error(`WhatsApp ${res.status}${e.code ? ` (${e.code})` : ''}: ${e.error_data?.details || e.message || 'error'}`);
      err.retryable = res.status === 429 || res.status >= 500 || RETRYABLE_CODES.has(e.code);
      throw err;
    }
    return (body.messages && body.messages[0] && body.messages[0].id) || null;
  };
}

/** Deliver due alerts. Safe to run from several processes (SKIP LOCKED). */
export async function processWhatsAppOutbox(pool, transport, { limit = 20, log = () => {} } = {}) {
  const client = await pool.connect();
  let jobs;
  try {
    await client.query('begin');
    ({ rows: jobs } = await client.query(
      `select * from whatsapp_outbox where status = 'queued' and next_attempt_at <= now()
        order by next_attempt_at limit $1 for update skip locked`, [limit]));
    if (jobs.length) {
      await client.query(`update whatsapp_outbox set status = 'sending', attempts = attempts + 1 where id = any($1)`, [jobs.map(j => j.id)]);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  const stats = { sent: 0, failed: 0, retried: 0 };
  for (const job of jobs) {
    try {
      const providerId = await transport({ to: job.to_phone, params: job.params, template: job.template, chatPhone: job.chat_phone });
      await pool.query(`update whatsapp_outbox set status='sent', sent_at=now(), provider_id=$2, last_error=null where id=$1`, [job.id, providerId]);
      stats.sent++;
    } catch (err) {
      const attempts = job.attempts + 1;
      const final = err.retryable === false || attempts >= MAX_ATTEMPTS;
      await pool.query(
        `update whatsapp_outbox set status=$2, last_error=$3, next_attempt_at = now() + ($4 || ' minutes')::interval where id=$1`,
        [job.id, final ? 'failed' : 'queued', String(err.message).slice(0, 500), String(2 ** attempts)]);
      final ? stats.failed++ : stats.retried++;
      log(`whatsapp ${job.id} (${job.template} → ${job.to_phone}) ${final ? 'FAILED' : 'will retry'}: ${err.message}`);
    }
  }
  return stats;
}

/** Re-queue a failed alert (admin action). */
export async function retryWhatsApp(db, id) {
  const { rowCount } = await db.query(
    `update whatsapp_outbox set status='queued', next_attempt_at=now(), attempts=0 where id=$1 and status in ('failed','queued')`, [id]);
  return rowCount > 0;
}
