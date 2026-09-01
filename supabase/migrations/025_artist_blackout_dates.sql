-- supabase/migrations/025_artist_blackout_dates.sql
-- Lets an artist mark date ranges as unavailable, so a venue can't
-- request a booking on those dates. Unlike most tables added this
-- session (booking_requests, venue_artist_ratings, notifications,
-- push_subscriptions), this one gets a REAL client-facing RLS policy
-- instead of "no policies, service-role only" — every row here is
-- owned and written by exactly one party (the artist), with no second
-- party ever writing to it. A venue only ever reads another artist's
-- blackout ranges indirectly, through the public availability endpoint
-- (already using a service-role client, same as it reads gigs today).

create table public.artist_blackout_dates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint artist_blackout_dates_range_check check (end_date >= start_date)
);

create index idx_artist_blackout_dates_user_id on public.artist_blackout_dates(user_id);

create trigger artist_blackout_dates_updated_at
  before update on public.artist_blackout_dates
  for each row execute function update_updated_at();

alter table public.artist_blackout_dates enable row level security;

create policy "Artists manage their own blackout dates"
  on public.artist_blackout_dates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
