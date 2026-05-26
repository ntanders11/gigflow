-- supabase/migrations/011_artist_profile_contact_email.sql
-- Adds a contact_email field to artist_profiles so artists can set
-- a booking email separate from their login email. Used as Reply-To
-- on all outgoing pitch emails.

ALTER TABLE public.artist_profiles
  ADD COLUMN IF NOT EXISTS contact_email TEXT;
