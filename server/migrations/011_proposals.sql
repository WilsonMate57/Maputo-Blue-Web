-- ─────────────────────────────────────────────────────────────────────────────
-- 011_proposals.sql — Commercial proposals. Quotations stop depending on a quote
-- request: each has its own number, customer and trip details, discounts, fees,
-- terms and versions, and an accepted one can become a booking. Existing
-- quotations are kept and filled in from their request. Additive only.
-- ─────────────────────────────────────────────────────────────────────────────

-- People and companies who received a proposal; they do not need an account.
create table contacts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  company      text,
  email        text not null,
  phone        text,
  country      text,
  client_type  text not null default 'individual'
               check (client_type in ('individual','group','company','agency','other')),
  nuit         text,
  address      text,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index contacts_email_uq on contacts (lower(email));

create table quote_sequences (
  year      integer primary key,
  last_seq  integer not null default 0
);

alter table quotes alter column request_id drop not null;
alter table quotes drop constraint quotes_status_check;
alter table quotes add constraint quotes_status_check check (status in (
  'draft','issued','sent','viewed','accepted','declined','revision_requested',
  'expired','converted','withdrawn','superseded'));

alter table quotes
  add column number             text,
  add column group_id           uuid,                 -- all versions of one proposal
  add column version            integer not null default 1,
  add column replaces_id        uuid references quotes(id),
  add column duplicated_from    uuid references quotes(id),
  add column contact_id         uuid references contacts(id) on delete set null,
  add column user_id            uuid references users(id) on delete set null,
  add column locale             text not null default 'pt' check (locale in ('pt','en')),
  add column customer           jsonb not null default '{}',  -- {name, company, email, phone, country, client_type, nuit, address}
  add column trip               jsonb not null default '{}',  -- {destination, date_from, date_to, days, nights, adults, children, experience, customer_notes}
  add column internal_notes     text,
  add column discount           jsonb,                        -- {kind: 'percent'|'fixed', value}
  add column fees               jsonb not null default '[]',  -- [{label, amount}]
  add column subtotal           numeric(12,2) not null default 0,
  add column discount_total     numeric(12,2) not null default 0,
  add column fees_total         numeric(12,2) not null default 0,
  add column payment_terms      text,
  add column deposit_percent    numeric(5,2),
  add column payment_due        text,
  add column cancellation_terms text,
  add column special_conditions text,
  add column itinerary          jsonb not null default '[]',  -- [{title, description}]
  add column issuer             jsonb,                        -- company details frozen at issue
  add column issued_at          timestamptz,
  add column viewed_at          timestamptz,
  add column view_count         integer not null default 0,
  add column token_nonce        integer not null default 0,
  add column response_message   text,
  add column updated_at         timestamptz not null default now();

-- Existing quotations: number, customer and trip come from their request
with numbered as (
  select id, extract(year from created_at)::int as y,
         row_number() over (partition by extract(year from created_at) order by created_at, id) as n
    from quotes
)
update quotes q set
  group_id = q.id,
  number = 'COT-' || numbered.y || '-' || lpad(numbered.n::text, 4, '0'),
  subtotal = q.total,
  issued_at = q.sent_at
from numbered where numbered.id = q.id;

update quotes q set
  locale = case when r.locale = 'en' then 'en' else 'pt' end,
  user_id = r.user_id,
  customer = jsonb_strip_nulls(jsonb_build_object(
    'name', r.name, 'email', r.email, 'phone', r.phone,
    'company', r.billing->>'company_name', 'nuit', r.billing->>'nuit', 'address', r.billing->>'address',
    'client_type', case when r.billing->>'company_name' is null then 'individual' else 'company' end)),
  trip = jsonb_strip_nulls(jsonb_build_object(
    'destination', r.destination, 'date_from', r.date_from, 'date_to', r.date_to,
    'adults', r.adults, 'children', r.children))
from custom_requests r where r.id = q.request_id;

insert into quote_sequences (year, last_seq)
select substr(number, 5, 4)::int, max(substr(number, 10)::int) from quotes group by 1;

alter table quotes alter column number set not null;
alter table quotes alter column group_id set not null;
alter table quotes alter column group_id set default gen_random_uuid();
create unique index quotes_number_version_uq on quotes (number, version);
create index quotes_group_idx on quotes (group_id, version desc);
create index quotes_status_idx on quotes (status, created_at desc);
create index quotes_email_idx on quotes (lower(customer->>'email'));

-- The PDF exactly as issued: an issued version never changes.
create table quote_documents (
  quote_id    uuid primary key references quotes(id) on delete cascade,
  pdf         bytea not null,
  sha256      text not null,
  created_at  timestamptz not null default now()
);

-- A booking made from a proposal keeps its origin; one proposal, one booking.
alter table bookings add column quote_id uuid unique references quotes(id) on delete set null;

-- A proposal can hold several packages on the same day.
alter table booking_allocations drop constraint booking_allocations_pkey;
alter table booking_allocations add primary key (booking_id, package_id, resource_key, day);

-- Internal package behind bookings made from proposals (bookings need one).
-- Archived: never public, and hidden from the panel's package list.
insert into packages (id, kind, category, status, content, pricing)
values ('proposta-personalizada', 'tour', 'custom', 'archived',
        '{"title": "Proposta personalizada", "title_en": "Tailor-made proposal"}',
        '{"currency": "MZN", "unit": "per_group", "adult": 0, "options": [], "extras": [], "transfers": []}')
on conflict (id) do nothing;
