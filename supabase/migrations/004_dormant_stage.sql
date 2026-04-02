-- supabase/migrations/004_dormant_stage.sql
ALTER TYPE venue_stage ADD VALUE IF NOT EXISTS 'dormant';
