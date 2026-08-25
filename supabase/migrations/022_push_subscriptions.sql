-- supabase/migrations/022_push_subscriptions.sql
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index idx_push_subscriptions_user on public.push_subscriptions (user_id);

-- RLS is enabled (required so PostgREST doesn't expose this table to
-- anon/authenticated clients directly) but deliberately gets NO policies
-- — every read/write goes through the service-role client from a server
-- route that's already verified the caller's identity. Same pattern as
-- notifications, booking_requests, and venue_artist_ratings.
alter table public.push_subscriptions enable row level security;
