-- ─────────────────────────────────────────────────────────────────────────────
-- 001_init.sql — Maputo Blue core schema
-- Catalogue, pricing, availability, bookings, accounts, loyalty, custom
-- requests, reviews, media, e-mail outbox and audit log.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── Settings (key → JSON value) ─────────────────────────────────────────────
create table settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ── Users (customers and administrators) ────────────────────────────────────
create table users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  password_hash      text not null,
  name               text not null,
  phone              text,
  country            text,
  locale             text not null default 'pt' check (locale in ('pt','en')),
  role               text not null default 'customer' check (role in ('customer','admin')),
  email_verified_at  timestamptz,
  disabled_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

create table sessions (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ip          text,
  user_agent  text
);
create index sessions_user_idx on sessions (user_id);

-- One-time tokens for e-mail verification and password reset
create table auth_tokens (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  purpose     text not null check (purpose in ('verify_email','reset_password')),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ── Catalogue ───────────────────────────────────────────────────────────────
-- content: all display fields (bilingual), kept in the same shape as the
--          original JSON files so the public renderers keep working.
-- pricing: structured, validated pricing model (single source of truth).
-- availability: availability model (capacity unit, seasons, weekdays …).
create table packages (
  id            text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  kind          text not null check (kind in ('tour','accommodation')),
  category      text not null,
  status        text not null default 'draft' check (status in ('draft','published','archived')),
  featured      boolean not null default false,
  promotional   boolean not null default false,
  sort_order    integer not null default 0,
  content       jsonb not null default '{}',
  pricing       jsonb not null,
  availability  jsonb not null default '{}',
  seo           jsonb not null default '{}',
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references users(id)
);
create index packages_status_idx on packages (status, kind, sort_order);

-- Every saved version of a package (preview / rollback of catalogue edits)
create table package_revisions (
  id          bigserial primary key,
  package_id  text not null references packages(id) on delete cascade,
  version     integer not null,
  snapshot    jsonb not null,
  changed_by  uuid references users(id),
  changed_at  timestamptz not null default now(),
  unique (package_id, version)
);

-- Price rules: weekday/weekend, seasonal and date-specific overrides.
-- The rule with the highest priority that matches a date wins.
create table price_rules (
  id          bigserial primary key,
  package_id  text not null references packages(id) on delete cascade,
  label       text not null,
  date_from   date,
  date_to     date,
  weekdays    smallint[],            -- 0=Sun … 6=Sat; null = every day
  option_key  text,                  -- null = all options
  adult       numeric(12,2),
  child       numeric(12,2),
  priority    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check (date_to is null or date_from is null or date_to >= date_from),
  check (adult is null or adult >= 0),
  check (child is null or child >= 0)
);
create index price_rules_pkg_idx on price_rules (package_id) where active;

-- Per-day availability overrides (capacity, closures).
-- resource_key '*' = whole package; otherwise an option/room/boat key.
create table availability_days (
  package_id    text not null references packages(id) on delete cascade,
  resource_key  text not null default '*',
  day           date not null,
  capacity      integer check (capacity is null or capacity >= 0),
  closed        boolean not null default false,
  note          text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references users(id),
  primary key (package_id, resource_key, day)
);

-- ── Promotions ──────────────────────────────────────────────────────────────
create table promotions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text,                     -- null = applied automatically
  kind          text not null check (kind in ('percent','fixed')),
  value         numeric(12,2) not null check (value > 0),
  max_discount  numeric(12,2),
  package_ids   text[],                   -- null = all packages
  categories    text[],                   -- null = all categories
  starts_at     date,
  ends_at       date,
  travel_from   date,
  travel_to     date,
  min_pax       integer,
  min_total     numeric(12,2),
  usage_limit   integer,
  used_count    integer not null default 0,
  combinable    boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);
create unique index promotions_code_uq on promotions (upper(code)) where code is not null;

-- ── Bookings ────────────────────────────────────────────────────────────────
create table bookings (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique,
  package_id           text not null references packages(id),
  user_id              uuid references users(id) on delete set null,
  customer_name        text not null,
  customer_email       text not null,
  customer_phone       text not null,
  customer_country     text,
  locale               text not null default 'pt',
  start_date           date not null,
  end_date             date not null,
  adults               integer not null check (adults >= 0),
  children             integer not null default 0 check (children >= 0),
  option_key           text,
  extras               jsonb not null default '[]',
  transfer_key         text,
  customer_notes       text,
  status               text not null default 'pending'
                       check (status in ('pending','confirmed','rejected','cancelled','completed')),
  payment_status       text not null default 'unpaid'
                       check (payment_status in ('unpaid','partial','paid','refunded')),
  amount_paid          numeric(12,2) not null default 0,
  currency             text not null,
  total                numeric(12,2) not null,
  price_snapshot       jsonb not null,            -- immutable pricing at booking time
  hold_expires_at      timestamptz,
  idempotency_key      text unique,
  lookup_token_hash    text,
  cancel_requested_at  timestamptz,
  confirmed_at         timestamptz,
  cancelled_at         timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (end_date >= start_date)
);
create index bookings_status_idx  on bookings (status, start_date);
create index bookings_package_idx on bookings (package_id, start_date);
create index bookings_user_idx    on bookings (user_id);
create index bookings_email_idx   on bookings (lower(customer_email));
create index bookings_created_idx on bookings (created_at desc);

-- Capacity consumed by a booking, one row per day and resource.
create table booking_allocations (
  booking_id    uuid not null references bookings(id) on delete cascade,
  package_id    text not null,
  resource_key  text not null default '*',
  day           date not null,
  quantity      integer not null check (quantity > 0),
  primary key (booking_id, resource_key, day)
);
create index booking_alloc_lookup_idx on booking_allocations (package_id, resource_key, day);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references bookings(id) on delete cascade,
  amount       numeric(12,2) not null check (amount <> 0),
  method       text not null,
  reference    text,
  note         text,
  recorded_by  uuid references users(id),
  recorded_at  timestamptz not null default now()
);

-- ── Custom tour requests & quotations ───────────────────────────────────────
create table custom_requests (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,
  user_id           uuid references users(id) on delete set null,
  name              text not null,
  email             text not null,
  phone             text not null,
  locale            text not null default 'pt',
  destination       text,
  categories        text[] not null default '{}',
  date_from         date,
  date_to           date,
  flexible_dates    boolean not null default false,
  adults            integer not null default 1,
  children          integer not null default 0,
  accommodation     text,
  transport         text,
  activities        text,
  budget            numeric(12,2),
  budget_currency   text,
  special_requests  text,
  status            text not null default 'new'
                    check (status in ('new','under_review','quote_sent','accepted','rejected','closed')),
  idempotency_key   text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index custom_requests_status_idx on custom_requests (status, created_at desc);

create table quotes (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null references custom_requests(id) on delete cascade,
  items              jsonb not null default '[]',   -- [{description, quantity, unit_price}]
  inclusions         text,
  exclusions         text,
  message            text,
  currency           text not null,
  total              numeric(12,2) not null,
  valid_until        date not null,
  status             text not null default 'draft'
                     check (status in ('draft','sent','accepted','declined','expired','withdrawn')),
  public_token_hash  text,
  sent_at            timestamptz,
  responded_at       timestamptz,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now()
);

-- ── Internal notes (bookings, requests, customers) ──────────────────────────
create table internal_notes (
  id           bigserial primary key,
  entity_type  text not null check (entity_type in ('booking','request','user')),
  entity_id    text not null,
  body         text not null,
  author_id    uuid references users(id),
  created_at   timestamptz not null default now()
);
create index internal_notes_entity_idx on internal_notes (entity_type, entity_id);

-- ── Loyalty manual adjustments ──────────────────────────────────────────────
create table loyalty_adjustments (
  id          bigserial primary key,
  user_id     uuid not null references users(id) on delete cascade,
  delta       integer not null,         -- qualifying bookings added/removed
  reason      text not null,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now()
);

-- ── Reviews (migrated from Firestore) ───────────────────────────────────────
create table reviews (
  id          uuid primary key default gen_random_uuid(),
  package_id  text not null,
  name        text not null check (length(name) between 1 and 80),
  rating      integer not null check (rating between 1 and 5),
  comment     text not null check (length(comment) between 1 and 1000),
  status      text not null default 'published' check (status in ('published','hidden')),
  booking_id  uuid references bookings(id) on delete set null,
  source      text not null default 'web',
  legacy_id   text unique,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index reviews_package_idx on reviews (package_id, created_at desc) where status = 'published';

-- ── Media library ───────────────────────────────────────────────────────────
create table media (
  id             uuid primary key default gen_random_uuid(),
  path           text not null unique,     -- site-relative, e.g. assets/images/tours/x.webp
  original_name  text,
  width          integer,
  height         integer,
  bytes          integer,
  alt            text,
  alt_en         text,
  caption        text,
  caption_en     text,
  uploaded_by    uuid references users(id),
  created_at     timestamptz not null default now()
);

-- ── E-mail outbox ───────────────────────────────────────────────────────────
create table mail_outbox (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique,
  to_email         text not null,
  template         text not null,
  locale           text not null default 'pt',
  data             jsonb not null default '{}',
  status           text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts         integer not null default 0,
  last_error       text,
  next_attempt_at  timestamptz not null default now(),
  provider_id      text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index mail_outbox_due_idx on mail_outbox (next_attempt_at) where status = 'queued';

-- ── Audit log ───────────────────────────────────────────────────────────────
create table audit_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor_id     uuid references users(id) on delete set null,
  actor_type   text not null check (actor_type in ('admin','customer','guest','system')),
  entity_type  text not null,
  entity_id    text not null,
  action       text not null,
  data         jsonb not null default '{}'
);
create index audit_entity_idx on audit_log (entity_type, entity_id, at desc);
create index audit_at_idx on audit_log (at desc);

-- ── Default settings ────────────────────────────────────────────────────────
insert into settings (key, value) values
  ('booking',  '{"pending_holds_capacity": true, "pending_hold_hours": 48, "auto_complete": true, "min_lead_hours": 24, "max_advance_days": 365}'),
  ('loyalty',  '{"enabled": false, "min_completed_bookings": 3, "window_months": 24, "kind": "percent", "value": 5, "max_discount": null, "categories": null, "combinable_with_promotions": false, "require_verified_email": true}'),
  ('notifications', '{"admin_emails": [], "reminder_days_before": 2}');
