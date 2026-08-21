-- ============================================================
-- BOOKING REQUESTS
-- A venue proposes a date/time to an artist; the artist accepts
-- or declines. Tracks its own lifecycle independently of the
-- artist's Gig calendar until accepted, at which point a real
-- Gig is created and linked back via gig_id.
--
-- No client-facing RLS policies — same reasoning as
-- venue_artist_ratings (018): Postgres RLS restricts which ROWS
-- a policy allows, not which COLUMNS within an allowed row, so a
-- policy letting an artist "update their own requests" couldn't
-- stop them from also rewriting the venue's original date or
-- message. "Artist's response endpoint can only ever change
-- status" is enforced in application code instead. Every
-- read/write goes through a server route using the service-role
-- client.
-- ============================================================

create table public.booking_requests (
  id                uuid primary key default gen_random_uuid(),
  venue_profile_id  uuid not null references public.venue_profiles(id) on delete cascade,
  artist_user_id    uuid not null references public.profiles(id) on delete cascade,

  date              date not null,
  start_time        text,   -- HH:MM, matches gigs.start_time's format
  end_time          text,   -- HH:MM
  message           text,

  status            text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  gig_id            uuid references public.gigs(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_booking_requests_artist_user_id on public.booking_requests(artist_user_id);
create index idx_booking_requests_venue_profile_id on public.booking_requests(venue_profile_id);

create trigger booking_requests_updated_at
  before update on public.booking_requests
  for each row execute function update_updated_at();

alter table public.booking_requests enable row level security;
-- Deliberately no policies — see header comment above.
