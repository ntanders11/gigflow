-- Reply detection (Outlook first): an artist can opt in to have StageReach look
-- at their inbox for replies from venues in their pipeline. It only matches the
-- sender's address against the pipeline; it stores the subject line of a matched
-- reply, never the message body.
alter table public.email_connections
  add column if not exists reply_detection_enabled boolean not null default false,
  add column if not exists reply_scan_cursor timestamptz;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent',
    'booking_cancelled_by_venue', 'booking_cancelled_by_artist',
    'booking_rescheduled', 'gig_reminder', 'message_received',
    'connect_email_reminder', 'announcement', 'venue_reminder', 'reply_received'
  ));
