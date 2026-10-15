-- Time zone for each account, so calendar feeds show gigs at the right hour.
-- Existing accounts keep Pacific time (what the app has always assumed).
-- A gig uses the venue's zone when the venue is a StageReach account, and the
-- artist's zone otherwise.
alter table public.artist_profiles
  add column if not exists time_zone text not null default 'America/Los_Angeles';
alter table public.venue_profiles
  add column if not exists time_zone text not null default 'America/Los_Angeles';
