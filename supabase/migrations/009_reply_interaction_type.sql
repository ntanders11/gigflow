-- supabase/migrations/009_reply_interaction_type.sql
ALTER TYPE interaction_type ADD VALUE IF NOT EXISTS 'reply';
