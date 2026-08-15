-- ============================================================
-- ZONE COORDINATES (cached)
-- Adds cached lat/lon to zones so venue-side artist search
-- doesn't have to re-geocode every artist's zone on every
-- search. Populated lazily by the search endpoint the first
-- time it encounters a zone with no cached coordinates —
-- nothing backfills existing zones up front.
--
-- geocode_failed marks zones whose name could not be geocoded
-- (e.g. unparseable/garbage zone names) so the search endpoint
-- stops silently retrying them on every future search — without
-- this, a permanently-failing zone would be a standing, invisible
-- drain on Google's shared daily geocoding quota.
-- ============================================================

alter table public.zones
  add column lat double precision,
  add column lon double precision,
  add column geocode_failed boolean not null default false;
