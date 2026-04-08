-- Add display_name and phone to artist_profiles
ALTER TABLE artist_profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;
