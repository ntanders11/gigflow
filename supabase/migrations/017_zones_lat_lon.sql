-- ============================================================
-- ZONE COORDINATES (cached)
-- Adds cached lat/lon to zones so venue-side artist search
-- doesn't have to re-geocode every artist's zone on every
-- search. Populated lazily by the search endpoint the first
-- time it encounters a zone with no cached coordinates —
-- nothing backfills existing zones up front.
-- ============================================================

alter table public.zones
  add column lat double precision,
  add column lon double precision;
