-- ============================================================
-- VENUE PROFILES
-- A venue's own account — separate from the private `venues`
-- rows that live inside each artist's pipeline. One row per
-- venue account. venue_name is null while signup is still in
-- progress (see the venue signup flow) — the app uses that to
-- tell "mid-signup" apart from "fully signed up."
-- ============================================================

create table public.venue_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,

  venue_name        text,
  address           text,
  city              text,
  venue_type        text,           -- same vocabulary as venues.type (bar, brewery, winery, etc.)
  contact_email     text,
  contact_phone     text,
  description       text,
  genres            text[] default '{}',
  stage_equipment   text,
  photo_url         text,

  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),

  unique(user_id)
);

create trigger venue_profiles_updated_at
  before update on public.venue_profiles
  for each row execute function update_updated_at();

-- Prevents two accounts from ever completing signup as the same venue —
-- the second write to complete a matching (name, city) pair is rejected
-- at the database level. Only applies once BOTH venue_name and city are
-- set (a partial index), since city is optional and two nameless-city
-- venues with the same name are an acceptable, rare gap (the app-level
-- "already claimed" check from search still catches most real cases).
create unique index venue_profiles_name_city_unique
  on public.venue_profiles (lower(trim(venue_name)), lower(trim(city)))
  where venue_name is not null and city is not null;

alter table public.venue_profiles enable row level security;

-- Owner can read, insert, update, delete their own profile only.
-- No public-read policy — unlike artist_profiles, nothing needs to
-- read a venue's profile before the (future) discovery spec exists.
create policy "own venue profile"
  on public.venue_profiles
  for all
  using (auth.uid() = user_id);

-- ============================================================
-- LINK: venues.venue_profile_id
-- Points an artist's private pipeline row at a real venue
-- account, once one exists and matches. Nullable, never
-- required. Setting/clearing it never touches any other column
-- on the row (notes, stage, confidence, contact info are all
-- untouched) and is done exclusively via a service-role write —
-- an artist's own RLS session can read this column but the
-- "linking sweep" writes to OTHER artists' rows via service role,
-- same as the existing CSV import route does for bulk writes.
-- ============================================================

alter table public.venues
  add column venue_profile_id uuid references public.venue_profiles(id) on delete set null;

create index idx_venues_venue_profile_id on public.venues(venue_profile_id) where venue_profile_id is not null;
