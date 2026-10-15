-- supabase/migrations/034_venue_calendar_token.sql
-- A private, unguessable code used only inside a venue's calendar-subscription
-- link (/api/calendar/venue-ics?t=...). The venue's profile id can't be used
-- for this because it appears in the public venue page address. Existing
-- table, so no new grants are needed; every existing venue gets its own value.
alter table public.venue_profiles
  add column calendar_token uuid not null default gen_random_uuid();

create unique index idx_venue_profiles_calendar_token on public.venue_profiles(calendar_token);
