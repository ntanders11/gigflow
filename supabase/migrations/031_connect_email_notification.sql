-- supabase/migrations/031_connect_email_notification.sql
-- Allow a "connect your email" reminder notification, sent to artists who
-- signed up before Gmail/Outlook connecting existed (or skipped it) and are
-- still sending through the shared Resend address.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent',
    'booking_cancelled_by_venue', 'booking_cancelled_by_artist',
    'booking_rescheduled', 'gig_reminder', 'message_received',
    'connect_email_reminder'
  ));
