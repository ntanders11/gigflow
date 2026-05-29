-- supabase/migrations/013_add_stagereach_codes.sql
--
-- Adds cleaner invite codes for the StageReach beta.
-- Run this in the Supabase SQL Editor.
-- All codes are reusable — no per-user limit.

insert into public.invite_codes (code) values
  ('STAGEREACH2026'),   -- the main shareable link code
  ('STAGEREACH'),       -- easy to say out loud / text
  ('BETA'),             -- dead simple fallback
  ('MUSICIAN'),         -- thematic
  ('GIGFLOW')           -- legacy name, still recognizable
on conflict (code) do nothing;  -- safe to re-run if some already exist
