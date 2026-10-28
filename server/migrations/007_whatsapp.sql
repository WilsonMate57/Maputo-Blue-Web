-- ─────────────────────────────────────────────────────────────────────────────
-- 007_whatsapp.sql — Team alerts on WhatsApp (Meta Cloud API).
-- Same outbox pattern as mail_outbox: business operations enqueue inside their
-- transaction; a background worker delivers with retries. The recipients are
-- the team numbers in settings.notifications.admin_whatsapp.
-- ─────────────────────────────────────────────────────────────────────────────

create table whatsapp_outbox (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique,
  to_phone         text not null,              -- digits only, international format
  template         text not null,              -- internal alert type (admin_new_booking…)
  params           jsonb not null default '[]',-- body parameters of the Meta template
  status           text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts         integer not null default 0,
  last_error       text,
  next_attempt_at  timestamptz not null default now(),
  provider_id      text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index whatsapp_outbox_due_idx on whatsapp_outbox (next_attempt_at) where status = 'queued';
