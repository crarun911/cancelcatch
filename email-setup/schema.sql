-- CancelCatch — Supabase Schema
-- Run this in Supabase SQL editor

create table subscribers (
  id               uuid primary key default gen_random_uuid(),
  fname            text not null,
  lname            text,
  email            text not null unique,
  whatsapp         text,
  password_hash    text not null,
  centres          text[] not null,
  date_from        date,
  date_to          date,
  time_pref        text default 'any',
  notif_email      boolean default true,
  notif_wa         boolean default false,
  plan             text default 'trial',   -- trial | basic | standard
  stripe_customer_id text,
  stripe_sub_id    text,
  trial_ends_at    timestamptz,
  active           boolean default true,
  alerts_sent      integer default 0,
  last_alerted_at  timestamptz,
  created_at       timestamptz default now()
);

-- Alerts log — every alert sent
create table alerts_log (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid references subscribers(id) on delete cascade,
  centre        text not null,
  slot_date     date,
  slot_time     text,
  channel       text,   -- email | whatsapp
  sent_at       timestamptz default now()
);

-- Index for fast lookups
create index on subscribers(active, plan);
create index on subscribers(email);
create index on alerts_log(subscriber_id);
