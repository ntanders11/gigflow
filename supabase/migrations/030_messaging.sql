-- supabase/migrations/030_messaging.sql
-- In-app messaging between venues and artists.
-- conversations / messages / message_reports have RLS enabled with NO
-- policies: every read/write goes through a server route using the
-- service-role client after the caller is verified (same pattern as
-- booking_requests and venue_artist_ratings).

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  venue_profile_id uuid not null references public.venue_profiles(id) on delete cascade,
  artist_user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_by text check (blocked_by in ('artist', 'venue')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (venue_profile_id, artist_user_id)
);
create index idx_conversations_artist on public.conversations (artist_user_id, last_message_at desc);
create index idx_conversations_venue on public.conversations (venue_profile_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('artist', 'venue')),
  sender_user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size integer,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or attachment_path is not null)
);
create index idx_messages_conversation on public.messages (conversation_id, created_at);
create index idx_messages_unread on public.messages (conversation_id, sender_type) where read_at is null;

create table public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_reports enable row level security;

-- Email opt-out for "new message" emails. One column on profiles covers
-- both artist and venue logins (every account has a profiles row).
alter table public.profiles
  add column message_emails_enabled boolean not null default true;

-- Widen the notification types. Also adds gig_reminder, which the code
-- already uses but earlier constraints (023/024) never allowed.
alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent',
    'booking_cancelled_by_venue', 'booking_cancelled_by_artist',
    'booking_rescheduled', 'gig_reminder', 'message_received'
  ));

-- Private bucket for message attachments. No storage policies are created
-- on purpose: only the service role (and signed URLs it issues) can touch
-- these files. Bucket-level limits are a second line of defense on top of
-- the server-side checks in lib/messages/send.ts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments', 'message-attachments', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do nothing;

grant select on public.conversations to anon;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.conversations to service_role;

grant select on public.messages to anon;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.messages to service_role;

grant select on public.message_reports to anon;
grant select, insert, update, delete on public.message_reports to authenticated;
grant select, insert, update, delete on public.message_reports to service_role;
