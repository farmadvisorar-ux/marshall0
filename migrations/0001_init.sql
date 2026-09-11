-- Prospect Pro — Postgres schema (Neon / Vercel Postgres).
--
-- Authorization lives in the application, not the database: every query runs
-- through a server-side route that resolves the Clerk session to an account_id
-- first. There are no public database credentials, so there is no RLS layer
-- here — the connection string is a server secret and never reaches a browser.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

-- clerk_id is the join key to Clerk. Everything else about the person lives in
-- Clerk; we keep only what we need to render a page without a round trip.
create table if not exists users (
  id         uuid primary key default gen_random_uuid(),
  clerk_id   text unique not null,
  email      text not null,
  name       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  name             text,
  -- Which plan's feature set applies. During the free launch every account
  -- sits on 'pro' with free = true; the quota comes from launch.freeQuota.
  plan_id          text not null default 'pro'
                   check (plan_id in ('starter','pro','elite','enterprise')),
  free             boolean not null default true,
  founding_member  boolean not null default true,
  -- Timestamped, because it is the record of who drew the FCRA line and when.
  fcra_attested_at timestamptz,
  cycle_start      date not null default (date_trunc('month', now()))::date,
  created_at       timestamptz not null default now()
);

-- One account per user for now. The unique index is what makes the webhook's
-- provisioning idempotent: a replayed user.created cannot create a second.
create unique index if not exists accounts_user_id_key on accounts(user_id);

-- ---------------------------------------------------------------------------
-- Territory and saved work
-- ---------------------------------------------------------------------------

create table if not exists service_areas (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  name        text not null,
  county_fips text,
  state       text,
  created_at  timestamptz not null default now()
);
create index if not exists service_areas_account_id_idx on service_areas(account_id);

create table if not exists saved_searches (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name       text not null,
  industry   text not null,
  filters    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists saved_searches_account_id_idx on saved_searches(account_id);

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  service_area_id uuid references service_areas(id) on delete set null,
  industry        text not null,
  parcel_id       text not null,
  address         text,
  city            text,
  state           text,
  owner_name      text,
  -- The scored inputs, the per-signal points they earned, and the resulting
  -- score. Kept alongside the lead so a score stays explainable months later
  -- even after the upstream sources have moved on.
  signals         jsonb,
  contributions   jsonb,
  score           jsonb,
  storm           jsonb,
  roof            jsonb,
  owner           jsonb,
  hook            text,
  status          text not null default 'available'
                  check (status in ('available','contacted','won','lost','discarded')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- A parcel is one lead per account. Re-running a search refreshes the row it
-- already has rather than billing the same roof to the same contractor twice.
create unique index if not exists leads_account_parcel_key on leads(account_id, parcel_id);
create index if not exists leads_account_created_idx on leads(account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  event_type text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_account_id_idx on events(account_id, created_at desc);
