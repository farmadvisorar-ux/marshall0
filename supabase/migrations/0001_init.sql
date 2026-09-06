-- Prospect Pro — initial schema.
--
-- Every table carries row-level security keyed on account membership. That is
-- not belt-and-braces: the API keys that reach the browser are public by
-- design, so RLS is the only thing standing between one contractor's lead list
-- and another's. A missing policy here is a data breach, not a bug.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  email         text,
  full_name     text,
  business_name text,
  created_at    timestamptz not null default now()
);

create table public.accounts (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  -- Which plan's feature set applies. During the free launch every account
  -- sits on 'pro' with free = true; the quota comes from launch.freeQuota.
  plan_id          text not null default 'pro'
                   check (plan_id in ('starter','pro','elite','enterprise')),
  free             boolean not null default true,
  founding_member  boolean not null default true,
  -- Timestamped, because it is the record of who drew the FCRA line and when.
  fcra_attested_at timestamptz,
  fcra_attested_by uuid references auth.users,
  cycle_start      date not null default (date_trunc('month', now()))::date,
  created_at       timestamptz not null default now()
);

create table public.account_members (
  account_id uuid not null references public.accounts on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  role       text not null default 'owner' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index on public.account_members (user_id);

-- Membership lookup as SECURITY DEFINER so policies can call it without
-- re-entering the policy on account_members and recursing forever.
create or replace function public.is_member(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.account_members m
    where m.account_id = a and m.user_id = auth.uid()
  );
$$;

create or replace function public.my_account_id()
returns uuid language sql stable security definer set search_path = public as $$
  select m.account_id from public.account_members m
  where m.user_id = auth.uid()
  order by m.created_at limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

create table public.service_areas (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts on delete cascade,
  name         text not null,
  center_lat   double precision,
  center_lon   double precision,
  radius_miles numeric(6,2) default 25,
  postal_codes text[] default '{}',
  county_fips  text,
  created_at   timestamptz not null default now()
);
create index on public.service_areas (account_id);

create table public.saved_searches (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts on delete cascade,
  name        text not null,
  industry    text not null,
  filters     jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.saved_searches (account_id);

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create table public.leads (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts on delete cascade,
  industry       text not null,
  -- Natural key from the source records, so a re-run updates rather than
  -- duplicates. A customer who runs the same search twice must not be charged
  -- twice for the same row.
  parcel_id      text,
  address        text,
  city           text,
  state          text,
  postal         text,
  owner_name     text,
  owner_segment  text,
  score          smallint not null default 0 check (score between 0 and 100),
  grade          char(1) not null default 'D' check (grade in ('A','B','C','D')),
  confidence     numeric(4,3) not null default 0,
  hook           text,
  -- The explainable half of the score. Kept whole so a rep can always see why
  -- a lead ranked where it did, months after the sources have moved on.
  signals        jsonb not null default '{}'::jsonb,
  contributions  jsonb not null default '[]'::jsonb,
  storm          jsonb,
  roof           jsonb,
  source_refs    jsonb not null default '[]'::jsonb,
  status         text not null default 'new'
                 check (status in ('new','working','contacted','won','lost','discarded')),
  -- Null until the lead is actually released against quota. Held rows cost
  -- nothing, which is the point.
  released_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (account_id, industry, parcel_id)
);
create index on public.leads (account_id, score desc);
create index on public.leads (account_id, status);
create index on public.leads (account_id, released_at);

create table public.lead_contacts (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads on delete cascade,
  account_id      uuid not null references public.accounts on delete cascade,
  channel         text not null check (channel in ('email','sms','call','voicemail','mail')),
  value           text not null,
  phone_type      text check (phone_type in ('landline','wireless','voip','unknown')),
  -- TCPA safe harbour is 31 days. Null means never scrubbed, which the
  -- compliance layer treats as unscrubbed and withholds.
  dnc_scrubbed_at timestamptz,
  dnc_listed      boolean not null default false,
  litigator_flag  boolean not null default false,
  sms_consent_at  timestamptz,
  opted_out       boolean not null default false,
  opted_out_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index on public.lead_contacts (lead_id);
create index on public.lead_contacts (account_id);

-- Account-level opt-outs, honoured across every channel and every future pull.
create table public.suppression (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts on delete cascade,
  kind       text not null check (kind in ('email','phone','address','parcel')),
  value      text not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (account_id, kind, value)
);

-- ---------------------------------------------------------------------------
-- Usage
-- ---------------------------------------------------------------------------

create table public.usage_cycles (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts on delete cascade,
  cycle_start    date not null,
  leads_released integer not null default 0,
  -- What this month would have been billed at list. Drives the "bill you did
  -- not get" line, and is written at release time so it cannot be
  -- retroactively inflated.
  accrued_value  numeric(10,2) not null default 0,
  created_at     timestamptz not null default now(),
  unique (account_id, cycle_start)
);

create table public.events (
  id         bigserial primary key,
  account_id uuid references public.accounts on delete cascade,
  user_id    uuid references auth.users on delete set null,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.events (account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Provisioning
-- ---------------------------------------------------------------------------

-- One signup creates the profile, the account, the membership and a starting
-- service area. Doing it in a trigger rather than in application code means an
-- account can never be half-created by a request that died halfway.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_account uuid;
  label text;
begin
  label := coalesce(
    nullif(new.raw_user_meta_data->>'business_name', ''),
    split_part(coalesce(new.email, 'account'), '@', 1)
  );

  insert into public.profiles (id, email, full_name, business_name)
  values (new.id, new.email,
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'business_name');

  insert into public.accounts (name) values (label) returning id into new_account;

  insert into public.account_members (account_id, user_id, role)
  values (new_account, new.id, 'owner');

  insert into public.service_areas (account_id, name, center_lat, center_lon, radius_miles, county_fips)
  values (new_account, 'Home area', 32.5449, -94.3674, 25, '48203');

  insert into public.saved_searches (account_id, name, industry, filters)
  values (new_account, 'Roofing — storm exposure', 'roofing',
          '{"minScore": 40, "minRoofAge": 12}'::jsonb);

  insert into public.events (account_id, user_id, kind, detail)
  values (new_account, new.id, 'account.created', jsonb_build_object('plan', 'pro', 'free', true));

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.accounts        enable row level security;
alter table public.account_members enable row level security;
alter table public.service_areas   enable row level security;
alter table public.saved_searches  enable row level security;
alter table public.leads           enable row level security;
alter table public.lead_contacts   enable row level security;
alter table public.suppression     enable row level security;
alter table public.usage_cycles    enable row level security;
alter table public.events          enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "member reads account" on public.accounts
  for select using (public.is_member(id));
create policy "owner updates account" on public.accounts
  for update using (public.is_member(id)) with check (public.is_member(id));

create policy "member reads membership" on public.account_members
  for select using (user_id = auth.uid() or public.is_member(account_id));

-- The account-scoped tables all share one shape, so the policies do too.
create policy "member rw service areas" on public.service_areas
  for all using (public.is_member(account_id)) with check (public.is_member(account_id));
create policy "member rw saved searches" on public.saved_searches
  for all using (public.is_member(account_id)) with check (public.is_member(account_id));
create policy "member rw leads" on public.leads
  for all using (public.is_member(account_id)) with check (public.is_member(account_id));
create policy "member rw lead contacts" on public.lead_contacts
  for all using (public.is_member(account_id)) with check (public.is_member(account_id));
create policy "member rw suppression" on public.suppression
  for all using (public.is_member(account_id)) with check (public.is_member(account_id));
create policy "member reads usage" on public.usage_cycles
  for select using (public.is_member(account_id));
create policy "member reads events" on public.events
  for select using (public.is_member(account_id));

-- Usage and events are written by the server on the user's behalf. Insert is
-- allowed for members so the app can run on the user's own token rather than
-- needing a service key in the request path.
create policy "member writes usage" on public.usage_cycles
  for insert with check (public.is_member(account_id));
create policy "member updates usage" on public.usage_cycles
  for update using (public.is_member(account_id)) with check (public.is_member(account_id));
create policy "member writes events" on public.events
  for insert with check (public.is_member(account_id));

-- A suppressed contact disappears from future pulls everywhere, including rows
-- already released. Enforced in the database so no code path can forget it.
create or replace function public.apply_suppression()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.lead_contacts c
     set opted_out = true, opted_out_at = now()
    from public.leads l
   where c.lead_id = l.id
     and l.account_id = new.account_id
     and (
       (new.kind = 'email'  and lower(c.value) = lower(new.value)) or
       (new.kind = 'phone'  and regexp_replace(c.value, '\D', '', 'g') = regexp_replace(new.value, '\D', '', 'g'))
     );

  update public.leads
     set status = 'discarded'
   where account_id = new.account_id
     and ((new.kind = 'parcel'  and parcel_id = new.value)
       or (new.kind = 'address' and lower(address) = lower(new.value)));

  return new;
end $$;

create trigger suppression_applies after insert on public.suppression
  for each row execute function public.apply_suppression();
