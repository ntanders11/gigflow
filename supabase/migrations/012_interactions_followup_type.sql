-- Add "follow_up" as an allowed interaction type.
-- The interactions.type column is plain TEXT with no check constraint,
-- so this migration is a no-op on the DB side — it documents the new
-- value and serves as a record for schema history.
DO $$ BEGIN
  RAISE NOTICE 'interactions.type now accepts follow_up';
END $$;
