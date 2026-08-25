-- supabase/migrations/023_booking_cancellation.sql
-- Lets either party cancel a booking. Widens booking_requests.status to
-- add 'cancelled' and records who cancelled it; widens notifications.type
-- to add the two new notification types this triggers. gigs.status
-- already supports 'cancelled' (migration 007) — no change needed there.

alter table public.booking_requests
  drop constraint booking_requests_status_check;

alter table public.booking_requests
  add constraint booking_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled'));

alter table public.booking_requests
  add column cancelled_by text check (cancelled_by in ('artist', 'venue'));

alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent',
    'booking_cancelled_by_venue', 'booking_cancelled_by_artist'
  ));
