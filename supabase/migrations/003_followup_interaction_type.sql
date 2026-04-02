-- supabase/migrations/003_followup_interaction_type.sql
ALTER TYPE interaction_type ADD VALUE IF NOT EXISTS 'follow_up';
