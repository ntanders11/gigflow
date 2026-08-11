-- supabase/migrations/014_email_connections.sql
--
-- Lets an artist connect their own Gmail or Outlook account so pitch/follow-up
-- emails can send from their real address instead of the shared StageReach sender.
-- One row per artist per provider. access_token/refresh_token/expires_at are
-- overwritten in place whenever the app refreshes this connection's token.

create table public.email_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  provider        text not null check (provider in ('gmail', 'outlook')),
  connected_email text not null,
  access_token    text not null,
  refresh_token   text not null,
  expires_at      timestamptz not null,
  scope           text not null,
  status          text not null default 'active' check (status in ('active', 'needs_reconnect')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, provider)
);

create index idx_email_connections_user_id on public.email_connections(user_id);

-- Reuses the update_updated_at() function defined in 001_initial_schema.sql.
-- This is what makes "most recently connected/refreshed" a reliable signal —
-- see lib/email/send-artist-email.ts.
create trigger email_connections_updated_at
  before update on public.email_connections
  for each row execute function update_updated_at();

alter table public.email_connections enable row level security;

create policy "own email connections only"
  on public.email_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
