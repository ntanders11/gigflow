-- supabase/migrations/010_invite_codes.sql

-- ============================================================
-- INVITE CODES
-- Reusable beta access codes. No RLS — queried only via
-- service role from the validate-code API route.
-- ============================================================

create table public.invite_codes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  active     boolean not null default true,
  created_at timestamptz default now()
);

-- Seed with 20 reusable beta codes
insert into public.invite_codes (code) values
  ('GIGFLOW-BETA-01'), ('GIGFLOW-BETA-02'), ('GIGFLOW-BETA-03'),
  ('GIGFLOW-BETA-04'), ('GIGFLOW-BETA-05'), ('GIGFLOW-BETA-06'),
  ('GIGFLOW-BETA-07'), ('GIGFLOW-BETA-08'), ('GIGFLOW-BETA-09'),
  ('GIGFLOW-BETA-10'), ('GIGFLOW-BETA-11'), ('GIGFLOW-BETA-12'),
  ('GIGFLOW-BETA-13'), ('GIGFLOW-BETA-14'), ('GIGFLOW-BETA-15'),
  ('GIGFLOW-BETA-16'), ('GIGFLOW-BETA-17'), ('GIGFLOW-BETA-18'),
  ('GIGFLOW-BETA-19'), ('GIGFLOW-BETA-20');

-- ============================================================
-- AUTO-PROFILE TRIGGER
-- When a new auth.users row is created, automatically insert
-- a matching profiles row. This satisfies the FK chain that
-- artist_profiles requires (user_id → profiles.id).
-- Uses SECURITY DEFINER so it runs as the table owner,
-- bypassing RLS on profiles.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
