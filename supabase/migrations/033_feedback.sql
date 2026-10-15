-- supabase/migrations/033_feedback.sql
-- Free-text feedback from artists and venues, submitted from their profile
-- page. Service-role only (RLS on, no policies): written by POST
-- /api/feedback, read by Taylor/Claude when planning work.
create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('artist', 'venue')),
  message     text not null,
  status      text not null default 'new' check (status in ('new', 'reviewed')),
  created_at  timestamptz not null default now()
);

create index idx_feedback_status_created on public.feedback(status, created_at desc);

alter table public.feedback enable row level security;

grant select on public.feedback to anon;
grant select, insert, update, delete on public.feedback to authenticated;
grant select, insert, update, delete on public.feedback to service_role;
