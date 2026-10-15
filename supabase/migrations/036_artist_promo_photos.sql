-- supabase/migrations/036_artist_promo_photos.sql
-- Promo photos an artist uploads (up to 8, enforced in app code) that a venue
-- can view and download only once it has an accepted booking with that
-- artist. Service-role only (RLS on, no policies): every read/write goes
-- through /api/promo-photos/* or /api/venue/artists/*/promo-photos, which do
-- the "is this an accepted booking?" check.
create table public.artist_promo_photos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null,
  content_type  text not null,
  size_bytes    integer not null,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

create index idx_artist_promo_photos_user on public.artist_promo_photos(user_id, position);

alter table public.artist_promo_photos enable row level security;

-- Private bucket, no storage policies: only the service role (and the signed
-- URLs it issues) can touch these files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'promo-photos', 'promo-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

grant select on public.artist_promo_photos to anon;
grant select, insert, update, delete on public.artist_promo_photos to authenticated;
grant select, insert, update, delete on public.artist_promo_photos to service_role;
