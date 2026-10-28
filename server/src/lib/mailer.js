// ─────────────────────────────────────────────────────────────────────────────
// mailer.js — Transactional outbox. Business operations only *enqueue* e-mails
// (inside their own transaction); a background worker delivers them through
// Resend with retries. A delivery failure never undoes a booking.
// The idempotency key makes enqueueing safe to repeat.
// ─────────────────────────────────────────────────────────────────────────────
import { renderTemplate } from './mail-templates.js';
import { enqueueAdminWhatsApp } from './whatsapp.js';

const MAX_ATTEMPTS = 6;

export async function enqueueMail(db, { key, to, template, locale = 'pt', data = {} }) {
  if (!to) return;
  const recipients = Array.isArray(to) ? to : [to];
  for (const addr of recipients) {
    await db.query(
      `insert into mail_outbox (idempotency_key, to_email, template, locale, data)
       values ($1,$2,$3,$4,$5) on conflict (idempotency_key) do nothing`,
      [recipients.length > 1 ? `${key}:${addr.toLowerCase()}` : key, addr, template, locale, JSON.stringify(data)]);
  }
}

/** Notify the team configured in settings.notifications: e-mail and, when set, WhatsApp. */
export async function notifyTeam(db, { key, template, data }) {
  const { rows } = await db.query(`select value from settings where key = 'notifications'`);
  const emails = (rows[0] && rows[0].value.admin_emails) || [];
  if (emails.length) await enqueueMail(db, { key, to: emails, template, locale: 'pt', data });
  await enqueueAdminWhatsApp(db, { key, template, data });
}

/** Default transport: Resend HTTP API. */
export function resendTransport(cfg) {
  return async ({ to, subject, html, text, idempotencyKey, attachments }) => {
    if (!cfg.resendApiKey) throw Object.assign(new Error('RESEND_API_KEY not configured'), { retryable: false });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.resendApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({ from: cfg.from, to: [to], reply_to: cfg.replyTo, subject, html, text,
        ...(attachments && attachments.length ? { attachments } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Resend ${res.status}: ${body.message || body.name || 'error'}`);
      err.retryable = res.status === 429 || res.status >= 500;
      throw err;
    }
    return body.id || null;
  };
}

/** Deliver due e-mails. Safe to run from several processes (SKIP LOCKED). */
export async function processOutbox(pool, transport, { limit = 20, log = () => {}, attachments = async () => [] } = {}) {
  const client = await pool.connect();
  let jobs;
  try {
    await client.query('begin');
    ({ rows: jobs } = await client.query(
      `select * from mail_outbox where status = 'queued' and next_attempt_at <= now()
        order by next_attempt_at limit $1 for update skip locked`, [limit]));
    if (jobs.length) {
      await client.query(`update mail_outbox set status = 'sending', attempts = attempts + 1 where id = any($1)`, [jobs.map(j => j.id)]);
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
      const msg = renderTemplate(job.template, job.locale, job.data);
      // Attachments (e.g. the ticket PDF) are generated at send time from the current booking
      const files = await attachments(job);
      const providerId = await transport({ to: job.to_email, ...msg, idempotencyKey: job.idempotency_key, attachments: files });
      await pool.query(`update mail_outbox set status='sent', sent_at=now(), provider_id=$2, last_error=null where id=$1`, [job.id, providerId]);
      stats.sent++;
    } catch (err) {
      const attempts = job.attempts + 1;
      const final = err.retryable === false || attempts >= MAX_ATTEMPTS;
      await pool.query(
        `update mail_outbox set status=$2, last_error=$3, next_attempt_at = now() + ($4 || ' minutes')::interval where id=$1`,
        [job.id, final ? 'failed' : 'queued', String(err.message).slice(0, 500), String(2 ** attempts)]);
      final ? stats.failed++ : stats.retried++;
      log(`mail ${job.id} (${job.template} → ${job.to_email}) ${final ? 'FAILED' : 'will retry'}: ${err.message}`);
    }
  }
  return stats;
}

/** Re-queue a failed e-mail (admin action). */
export async function retryMail(db, id) {
  const { rowCount } = await db.query(
    `update mail_outbox set status='queued', next_attempt_at=now(), attempts=0 where id=$1 and status in ('failed','queued')`, [id]);
  return rowCount > 0;
}
