-- supabase/migrations/032_announcement_notification.sql
-- A generic one-off notice type ("announcement") for messages from StageReach
-- itself (e.g. "add the app to your phone"), so each one doesn't need its own
-- migration. Keeps every existing type.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent',
    'booking_cancelled_by_venue', 'booking_cancelled_by_artist',
    'booking_rescheduled', 'gig_reminder', 'message_received',
    'connect_email_reminder', 'announcement'
  ));
