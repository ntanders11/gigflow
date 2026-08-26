-- supabase/migrations/024_booking_reschedule.sql
-- Lets a venue change the date/time of a booking they sent, with the
-- change reflected on the artist's calendar. Only widens the
-- notifications.type constraint to add the new notification this
-- triggers — no schema change needed to booking_requests or gigs,
-- since date/start_time/end_time are already writable columns on both.

alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent',
    'booking_cancelled_by_venue', 'booking_cancelled_by_artist',
    'booking_rescheduled'
  ));
