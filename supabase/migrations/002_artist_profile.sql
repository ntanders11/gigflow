-- ============================================================
-- ARTIST PROFILE
-- Taylor's EPK / booking profile. Stores bio, genre tags,
-- photo, social links, video/music samples, and rate packages.
-- One row per user. The public profile page reads this too.
-- ============================================================

create table public.artist_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,

  bio           text default '',
  genres        text[] default '{}',
  photo_url     text,

  -- Stored as JSON objects (see types/index.ts for shape)
  social_links  jsonb default '{}',
  video_samples jsonb default '[]',
  packages      jsonb default '[]',

  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),

  unique(user_id)
);

-- Auto-update updated_at on any change
create trigger artist_profiles_updated_at
  before update on public.artist_profiles
  for each row execute function update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.artist_profiles enable row level security;

-- Owner can read, insert, update, delete their own profile
create policy "own artist profile"
  on public.artist_profiles
  for all
  using (auth.uid() = user_id);

-- Anyone (logged in or not) can read profiles — needed for the
-- public shareable EPK page at /profile/[id]
create policy "public can read artist profiles"
  on public.artist_profiles
  for select
  using (true);

-- ============================================================
-- STORAGE — artist-photos bucket
-- Run this AFTER the table migration above.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('artist-photos', 'artist-photos', true)
on conflict (id) do nothing;

-- Users can upload into a folder named after their own user ID
create policy "users upload own photos"
  on storage.objects
  for insert
  with check (
    bucket_id = 'artist-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can update/replace their own photos
create policy "users update own photos"
  on storage.objects
  for update
  using (
    bucket_id = 'artist-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Anyone can view photos (they are in a public bucket)
create policy "artist photos are public"
  on storage.objects
  for select
  using (bucket_id = 'artist-photos');
