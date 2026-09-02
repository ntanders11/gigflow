-- Day-of gig reminders: tracks whether the automated reminder for a gig
-- has already gone out, so the daily cron (app/api/gigs/reminders/route.ts)
-- never sends the same reminder twice for the same gig even if it's
-- triggered more than once on the same day.
alter table public.gigs
  add column reminder_sent_at timestamptz;
