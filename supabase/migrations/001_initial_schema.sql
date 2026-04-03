-- GigFlow - Initial Schema
-- Run this in the Supabase SQL Editor to set up the database.

-- ============================================================
-- ENUMS
-- These are fixed lists of allowed values. Using enums means
-- the database itself rejects typos like "Discoverd" or "bokkd".
-- ============================================================

create type venue_stage as enum (
  'discovered',   -- Found it, haven't reached out yet
  'contacted',    -- Sent a pitch email or called
  'responded',    -- They wrote back or picked up
  'negotiating',  -- Actively discussing dates/pay
  'booked'        -- Confirmed gig on the calendar
);

create type confidence_level as enum (
  'HIGH',    -- Confirmed they book live music
  'MEDIUM',  -- Likely books live music, not confirmed
  'LOW'      -- Uncertain
);

create type interaction_type as enum (
  'email',      -- Sent or received an email
  'call',       -- Phone call
  'in_person',  -- Stopped by or met them at the venue
  'note'        -- Just a note to yourself
);

-- ============================================================
-- PROFILES
-- Supabase handles login via its own auth.users table.
-- This table extends that with app-level info.
-- For now it's just Taylor, but multi-tenant ready.
-- ============================================================

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email        text,
  created_at   timestamptz default now()
);

-- ============================================================
-- ZONES
-- A zone is a geographic territory you're targeting.
-- For now: just "Newberg, OR" with a 30mi radius.
-- Later: add Portland, Salem, etc. as separate zones.
-- ============================================================

create table public.zones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,        -- e.g. "Newberg, OR"
  zip_code    text,                 -- e.g. "97132"
  radius_mi   integer default 30,
  created_at  timestamptz default now(),
  unique(user_id, name)
);

-- ============================================================
-- VENUES
-- The core entity. Everything revolves around venues.
-- The `stage` column is what drives the Kanban board.
-- ============================================================

create table public.venues (
  id                  uuid primary key default gen_random_uuid(),
  zone_id             uuid not null references public.zones(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,

  -- Who they are
  name                text not null,
  type                text,           -- "Winery", "Brewery", "Bar & Grill"
  city                text,
  website             text,

  -- How to reach them
  contact_email       text,
  contact_phone       text,
  contact_name        text,           -- Often unknown until you reach out

  -- Where they are in your pipeline
  stage               venue_stage not null default 'discovered',
  confidence          confidence_level default 'MEDIUM',

  -- Notes from research (imported from CSV)
  live_music_details  text,           -- e.g. "Fridays 7-9 PM"
  zone_ring           text,           -- "0-10mi" or "10-30mi" (from research)

  -- Your personal notes
  notes               text,

  -- Tracking
  last_contacted_at   timestamptz,
  follow_up_date      date,           -- When to check back in

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Auto-update the updated_at timestamp whenever a venue row changes
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger venues_updated_at
  before update on public.venues
  for each row execute function update_updated_at();

-- ============================================================
-- INTERACTIONS
-- Every time you touch a venue: email, call, note, visit.
-- This is the history log on the venue detail page.
-- ============================================================

create table public.interactions (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,

  type          interaction_type not null,
  notes         text,
  occurred_at   timestamptz not null default now(),

  -- Only filled in when type = 'email'
  email_subject text,
  email_body    text,
  email_sent    boolean default false,
  resend_id     text,   -- Resend's message ID, for future delivery tracking

  created_at    timestamptz default now()
);

-- ============================================================
-- INDEXES
-- These make common queries fast. Without them, searching
-- "all venues for this user" scans every row in the table.
-- ============================================================

create index idx_venues_user_id     on public.venues(user_id);
create index idx_venues_zone_id     on public.venues(zone_id);
create index idx_venues_stage       on public.venues(stage);
create index idx_venues_follow_up   on public.venues(follow_up_date) where follow_up_date is not null;
create index idx_interactions_venue on public.interactions(venue_id);
create index idx_interactions_date  on public.interactions(occurred_at desc);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- This is Supabase's way of saying "users can only see their
-- own data." Even if someone had the database URL, they couldn't
-- read another user's venues. Critical for multi-tenant later.
-- ============================================================

alter table public.profiles     enable row level security;
alter table public.zones        enable row level security;
alter table public.venues       enable row level security;
alter table public.interactions enable row level security;

create policy "own profile only"      on public.profiles     for all using (auth.uid() = id);
create policy "own zones only"        on public.zones        for all using (auth.uid() = user_id);
create policy "own venues only"       on public.venues       for all using (auth.uid() = user_id);
create policy "own interactions only" on public.interactions for all using (auth.uid() = user_id);

-- ============================================================
-- SEED DATA
-- After you sign up, run this to create your zone.
-- Replace <YOUR_USER_ID> with your Supabase user ID
-- (found in Authentication > Users in the Supabase dashboard).
-- ============================================================

-- insert into public.zones (user_id, name, zip_code, radius_mi)
-- values ('<YOUR_USER_ID>', 'Newberg, OR', '97132', 30);
