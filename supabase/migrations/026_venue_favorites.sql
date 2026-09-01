-- supabase/migrations/026_venue_favorites.sql
-- Lets a venue save artists to a private list. Like artist_blackout_dates
-- (migration 025), this gets a real client-facing RLS policy rather than
-- "no policies, service-role only" — every row is owned and written by
-- exactly one party (the venue), with no second party ever writing to it,
-- and no artist ever needs to read it at all.

create table public.venue_favorites (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  artist_user_id  uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),

  unique (user_id, artist_user_id)
);

create index idx_venue_favorites_user_id on public.venue_favorites(user_id);

alter table public.venue_favorites enable row level security;

create policy "Venues manage their own favorites"
  on public.venue_favorites
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
