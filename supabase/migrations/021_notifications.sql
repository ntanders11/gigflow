-- supabase/migrations/021_notifications.sql
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent'
  )),
  title text not null,
  body text,
  link text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;
create index idx_notifications_user_created on public.notifications (user_id, created_at desc);

-- RLS is enabled (required so PostgREST doesn't expose this table to
-- anon/authenticated clients directly) but deliberately gets NO policies
-- — every read/write goes through the service-role client from a server
-- route that's already verified the caller's identity. Same pattern as
-- booking_requests and venue_artist_ratings.
alter table public.notifications enable row level security;
