-- "Remind me later": a venue can be put aside (Dormant) with a date to check
-- back in and a short note ("not booking until spring"). The daily job turns a
-- due date into one bell notification (remind_notified_at stops repeats).
alter table public.venues
  add column if not exists remind_on date,
  add column if not exists remind_note text,
  add column if not exists remind_notified_at timestamptz;

create index if not exists idx_venues_remind_on on public.venues(remind_on) where remind_on is not null;

-- Allow the new notification type; keeps every existing one.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent',
    'booking_cancelled_by_venue', 'booking_cancelled_by_artist',
    'booking_rescheduled', 'gig_reminder', 'message_received',
    'connect_email_reminder', 'announcement', 'venue_reminder'
  ));
