-- supabase/migrations/015_interactions_sent_via.sql
--
-- Tracks which sender actually delivered an interaction's email: 'resend'
-- (shared sender), 'gmail', or 'outlook' (artist's own connected account).
-- interactions.type has no check constraint (see 012_interactions_followup_type.sql),
-- so this follows the same plain-column pattern.

alter table public.interactions
  add column if not exists sent_via text;

-- Every email ever sent before this migration went through the shared Resend
-- sender — backfill so historical rows aren't left null for no reason.
update public.interactions
  set sent_via = 'resend'
  where email_sent = true and sent_via is null;
