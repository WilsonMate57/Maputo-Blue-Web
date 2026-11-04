-- 012_live_chat.sql — Live chat between site visitors and the team.
-- Visitors need no account: a random token in a cookie opens their conversation,
-- and only its hash is stored here. Message ids grow per conversation because
-- each write locks the conversation row, so "after id N" never skips a message.

create table chat_conversations (
  id               uuid primary key default gen_random_uuid(),
  number           bigserial unique,                 -- shown as CHAT-123
  token_hash       text not null unique,
  name             text not null,
  email            text not null,
  phone            text,
  subject          text not null check (subject in ('bookings','packages','tours','transfers','accommodation','general','other')),
  locale           text not null default 'pt' check (locale in ('pt','en')),
  status           text not null default 'new' check (status in ('new','active','waiting','closed')),
  assigned_to      uuid references users(id) on delete set null,
  user_id          uuid references users(id) on delete set null,      -- verified account only
  booking_id       uuid references bookings(id) on delete set null,
  quote_id         uuid references quotes(id) on delete set null,
  package_id       text references packages(id) on delete set null,
  origin_path      text,
  current_path     text,
  current_title    text,
  started_offline  boolean not null default false,
  unread_agent     integer not null default 0,
  unread_visitor   integer not null default 0,
  agent_read_id    bigint not null default 0,        -- last message the team has seen
  visitor_read_id  bigint not null default 0,        -- last message the visitor has seen
  last_message_at  timestamptz not null default now(),
  last_preview     text,
  last_sender      text check (last_sender in ('visitor','agent','system')),
  last_visitor_at  timestamptz,
  visitor_seen_at  timestamptz,
  alerted_at       timestamptz,                      -- team alerted about the unanswered message
  mailed_at        timestamptz,                      -- visitor e-mailed about unread replies
  closed_at        timestamptz,
  closed_by        uuid references users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index chat_conversations_list_idx on chat_conversations (status, last_message_at desc);
create index chat_conversations_email_idx on chat_conversations (lower(email));

create table chat_messages (
  id               bigserial primary key,
  conversation_id  uuid not null references chat_conversations(id) on delete cascade,
  kind             text not null check (kind in ('visitor','agent','system','note')),
  author_id        uuid references users(id) on delete set null,
  author_name      text,
  body             text not null check (char_length(body) between 1 and 2000),
  client_id        uuid,                             -- sent twice = stored once
  created_at       timestamptz not null default now()
);
create index chat_messages_conversation_idx on chat_messages (conversation_id, id);
create unique index chat_messages_client_idx on chat_messages (conversation_id, client_id) where client_id is not null;

-- "online" only counts while the panel keeps sending its heartbeat
create table chat_agents (
  user_id       uuid primary key references users(id) on delete cascade,
  status        text not null default 'offline' check (status in ('online','away','offline')),
  last_seen_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create table chat_quick_replies (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  body_en     text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

insert into chat_quick_replies (title, body, body_en, sort_order) values
  ('Saudação inicial', 'Olá! Obrigado por contactar a Maputo Blue. Em que podemos ajudar?', 'Hello! Thank you for contacting Maputo Blue. How can we help you?', 1),
  ('Reservas', 'Para verificarmos a sua reserva, indique-nos a referência (MB-…) ou o nome e a data da viagem.', 'To check your booking, please send us the reference (MB-…) or the name and travel date.', 2),
  ('Disponibilidade', 'Para confirmarmos a disponibilidade, diga-nos a data e o número de pessoas.', 'To confirm availability, please tell us the date and the number of people.', 3),
  ('Pagamentos', 'Podemos explicar as formas de pagamento. A que reserva ou pacote se refere?', 'We can explain the payment options. Which booking or package is this about?', 4),
  ('Encerramento', 'Obrigado pelo contacto. Se precisar de mais alguma coisa, estamos aqui para ajudar.', 'Thank you for getting in touch. If you need anything else, we are here to help.', 5);

insert into settings (key, value) values ('chat', '{
  "enabled": true, "days": [0,1,2,3,4,5,6], "open": "07:00", "close": "17:30",
  "offline_message": "Neste momento, a nossa equipa está offline. Deixe-nos a sua mensagem e os seus contactos. Entraremos em contacto consigo assim que possível.",
  "offline_message_en": "Our team is offline right now. Leave us your message and contact details and we will get back to you as soon as possible.",
  "retention_months": 12, "alert_minutes": 5
}') on conflict (key) do nothing;
