-- supabase/migrations/029_venue_equipment.sql
-- Structured venue equipment: a checklist of gear the venue provides
-- (keys defined in lib/venues/equipment.ts) plus a free-text note on what
-- artists should bring. The existing free-text `stage_equipment` column
-- stays as-is and becomes the "other notes" field. Existing table, so no
-- new grants are needed.
alter table public.venue_profiles
  add column equipment_provided text[] not null default '{}',
  add column artist_should_bring text;
