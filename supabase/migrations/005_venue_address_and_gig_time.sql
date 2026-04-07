-- Add address and gig_time columns to venues
ALTER TABLE venues ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS gig_time TEXT; -- stored as HH:MM, e.g. "19:00"
