-- ─────────────────────────────────────────────────────────────────────────────
-- 003_invoices.sql — Invoices, gapless numbering, verified payments,
-- refunds/reversals and the issuer details printed on invoices.
-- Additive only: existing bookings and payments are kept as they are.
--
-- Separation of concerns
--   bookings.status          operational lifecycle (pending → confirmed → …)
--   invoices.doc_status      document lifecycle   (draft → issued → cancelled)
--   invoices.pay_status      financial state, derived from verified payments
--                            (unpaid | partially_paid | paid | refunded)
--   "overdue" is computed when reading (issued, not paid, due_date < today).
-- ─────────────────────────────────────────────────────────────────────────────

-- One counter row per series and year. The issuing transaction increments it
-- with INSERT … ON CONFLICT DO UPDATE, which row-locks the counter until
-- commit: concurrent issuers queue up, and a failed issuance rolls the
-- increment back, so numbers are unique, sequential and without gaps.
create table invoice_sequences (
  series       text    not null,
  year         integer not null,
  last_number  integer not null check (last_number >= 0),
  primary key (series, year)
);

create table invoices (
  id                   uuid primary key default gen_random_uuid(),
  booking_id           uuid not null references bookings(id),
  user_id              uuid references users(id) on delete set null,
  -- numbering (null while draft)
  series               text,
  year                 integer,
  seq                  integer,
  number               text unique,
  doc_status           text not null default 'draft' check (doc_status in ('draft','issued','cancelled')),
  pay_status           text not null default 'unpaid' check (pay_status in ('unpaid','partially_paid','paid','refunded')),
  locale               text not null default 'pt' check (locale in ('pt','en')),
  currency             text not null,
  -- immutable values once issued
  subtotal             numeric(12,2) not null default 0,
  discount_total       numeric(12,2) not null default 0,
  tax_total            numeric(12,2) not null default 0,
  total                numeric(12,2) not null check (total >= 0),
  lines                jsonb not null default '[]',   -- [{description, description_en, quantity, unit_price, amount}]
  discounts            jsonb not null default '[]',   -- [{description, description_en, amount}]
  tax                  jsonb not null default '{}',   -- {enabled, label, rate, mode}
  issuer               jsonb not null default '{}',   -- company details at issue time
  customer             jsonb not null default '{}',   -- billing details at issue time
  booking_snapshot     jsonb not null default '{}',   -- reference, title, dates, guests
  notes                text,
  payment_instructions text,
  issue_date           date,
  due_date             date,
  -- running financial state (kept in sync with payments, same transaction)
  amount_paid          numeric(12,2) not null default 0,
  paid_at              timestamptz,
  -- lifecycle
  created_by           uuid references users(id) on delete set null,
  issued_by            uuid references users(id) on delete set null,
  issued_at            timestamptz,
  cancelled_by         uuid references users(id) on delete set null,
  cancelled_at         timestamptz,
  cancel_reason        text,
  replaces_invoice_id  uuid references invoices(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((doc_status = 'draft') = (number is null)),
  check (doc_status <> 'cancelled' or (cancelled_at is not null and cancel_reason is not null)),
  check (due_date is null or issue_date is null or due_date >= issue_date),
  unique (series, year, seq)
);
-- At most one draft/issued invoice per booking (cancelled ones stay as history)
create unique index invoices_one_active_per_booking on invoices (booking_id) where doc_status <> 'cancelled';
create index invoices_status_idx on invoices (doc_status, pay_status, issue_date desc);
create index invoices_user_idx on invoices (user_id);
create index invoices_issue_date_idx on invoices (issue_date desc);

-- The PDF exactly as issued (archival copy). Later downloads render the same
-- snapshot with the current payment state; this copy never changes.
create table invoice_documents (
  invoice_id  uuid primary key references invoices(id),
  pdf         bytea not null,
  sha256      text not null,
  created_at  timestamptz not null default now()
);

-- ── Payments: verification, kinds, reversals, idempotency ───────────────────
alter table payments add column kind text not null default 'payment' check (kind in ('payment','refund','reversal'));
alter table payments add column currency text;
alter table payments add column payment_date date;
alter table payments add column invoice_id uuid references invoices(id);
alter table payments add column verified_by uuid references users(id) on delete set null;
alter table payments add column verified_at timestamptz;
alter table payments add column reverses_payment_id uuid unique references payments(id);
alter table payments add column idempotency_key text unique;

-- Existing rows were entered by administrators in the dashboard: keep them as
-- verified at the time they were recorded; negative amounts were refunds.
update payments p set
  kind = case when p.amount < 0 then 'refund' else 'payment' end,
  currency = b.currency,
  payment_date = (p.recorded_at at time zone 'Africa/Maputo')::date,
  verified_by = p.recorded_by,
  verified_at = p.recorded_at
from bookings b where b.id = p.booking_id;
alter table payments alter column currency set not null;
alter table payments alter column payment_date set not null;
alter table payments add constraint payments_sign_ck check ((kind = 'payment') = (amount > 0));
create index payments_booking_idx on payments (booking_id, recorded_at);
create index payments_invoice_idx on payments (invoice_id);
create index payments_date_idx on payments (payment_date);

-- ── Issuer details and invoicing options ────────────────────────────────────
-- Values supplied by the business. Tax is OFF until an accountant confirms the
-- applicable regime and rate; bank details are left empty until configured.
insert into settings (key, value) values ('invoicing', '{
  "series_prefix": "FT",
  "due_days": 7,
  "issuer": {
    "name": "Maputo Blue",
    "legal_name": "",
    "address": "Maputo Marina / 10 de Novembro Nr.74\nMaputo Cidade, Moçambique",
    "phone": "+258 (84) 712 1666",
    "email": "maputoblue.info@gmail.com",
    "nuit": "154 559 620",
    "website": "www.maputoblue.co.mz"
  },
  "tax": { "enabled": false, "label": "IVA", "rate": null, "mode": "inclusive" },
  "payment_instructions": "",
  "payment_instructions_en": "",
  "footer_note": "",
  "footer_note_en": ""
}') on conflict (key) do nothing;
