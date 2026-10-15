-- supabase/migrations/035_artist_calendar_token.sql
-- A private, unguessable code used only inside an artist's calendar-
-- subscription link (/api/calendar/ics?t=...). The old link was built from
-- the artist's account id, which is also in their public profile address
-- (/profile/<id>), so anyone with the public link could read their whole gig
-- list. Existing table, so no new grants; every existing artist gets their
-- own value.
alter table public.artist_profiles
  add column calendar_token uuid not null default gen_random_uuid();

create unique index idx_artist_profiles_calendar_token on public.artist_profiles(calendar_token);
