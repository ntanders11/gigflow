-- App error log. Server errors (instrumentation.ts) and browser errors
-- (POST /api/log-error) land here, one row per distinct error with a running
-- count, so a repeating bug shows up as one line with a big number instead of
-- thousands of rows. Service-role only (RLS on, no policies). Read by
-- Taylor/Claude at the start of a working session.
create table public.error_logs (
  id          uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  source      text not null check (source in ('server', 'browser')),
  message     text not null,
  stack       text,
  path        text,
  method      text,
  user_id     uuid,
  user_agent  text,
  count       integer not null default 1,
  status      text not null default 'new' check (status in ('new', 'reviewed')),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create index idx_error_logs_status_last_seen on public.error_logs(status, last_seen desc);

alter table public.error_logs enable row level security;

grant select on public.error_logs to anon;
grant select, insert, update, delete on public.error_logs to authenticated;
grant select, insert, update, delete on public.error_logs to service_role;
