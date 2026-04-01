-- supabase/migrations/003_invoices.sql

create type invoice_status as enum (
  'draft',
  'sent',
  'paid',
  'void'
);

create type payment_type as enum (
  'full',
  'deposit'
);

create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references public.venues(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,

  amount_cents        integer not null,
  payment_type        payment_type not null default 'full',
  event_date          date,
  package_label       text,
  description         text,

  status              invoice_status not null default 'draft',
  paid_at             timestamptz,

  stripe_invoice_id   text unique,
  stripe_invoice_url  text,

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function update_updated_at();

create index idx_invoices_venue_id on public.invoices(venue_id);
create index idx_invoices_user_id  on public.invoices(user_id);
create index idx_invoices_status   on public.invoices(status);

alter table public.invoices enable row level security;

create policy "own invoices only"
  on public.invoices
  for all
  using (auth.uid() = user_id);
