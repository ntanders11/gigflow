-- Bounce detection: when the daily inbox check finds an "undeliverable" notice
-- for a pipeline venue's contact email, the venue is tagged here and skipped by
-- follow-up emails until its contact email is changed (or the tag is cleared).
alter table public.venues
  add column if not exists email_bounced_at timestamptz;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent',
    'booking_cancelled_by_venue', 'booking_cancelled_by_artist',
    'booking_rescheduled', 'gig_reminder', 'message_received',
    'connect_email_reminder', 'announcement', 'venue_reminder', 'reply_received',
    'email_bounced'
  ));
