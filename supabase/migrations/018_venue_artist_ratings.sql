-- ============================================================
-- MUTUAL RATINGS
-- One row per venue-artist relationship, holding BOTH sides'
-- rating as two independent halves (not two separate rows).
-- "Revealed" means both *_rated_at are non-null — computed at
-- read time by API routes, never stored as a flag.
--
-- No client-facing RLS policies on either table below — Postgres
-- RLS controls which ROWS a query sees, not which COLUMNS, so
-- there's no way to express "hide the venue's half until the
-- artist's half is also filled in" with row-level policies alone.
-- Every read and write goes through a server route using the
-- service-role client, which decides in code what to return.
-- ============================================================

create table public.venue_artist_ratings (
  id                  uuid primary key default gen_random_uuid(),
  venue_profile_id    uuid not null references public.venue_profiles(id) on delete cascade,
  artist_user_id      uuid not null references public.profiles(id) on delete cascade,
  qualifying_gig_id   uuid references public.gigs(id) on delete set null,

  venue_stars         smallint check (venue_stars between 1 and 5),
  venue_review        text,
  venue_rated_at      timestamptz,

  artist_stars        smallint check (artist_stars between 1 and 5),
  artist_review       text,
  artist_rated_at     timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (venue_profile_id, artist_user_id)
);

create index idx_venue_artist_ratings_artist_user_id on public.venue_artist_ratings(artist_user_id);

create trigger venue_artist_ratings_updated_at
  before update on public.venue_artist_ratings
  for each row execute function update_updated_at();

alter table public.venue_artist_ratings enable row level security;
-- Deliberately no policies — see header comment above.

create table public.venue_artist_rating_reports (
  id                  uuid primary key default gen_random_uuid(),
  rating_id           uuid not null references public.venue_artist_ratings(id) on delete cascade,
  reporter_user_id    uuid not null references public.profiles(id) on delete cascade,
  reason              text,
  created_at          timestamptz not null default now()
);

alter table public.venue_artist_rating_reports enable row level security;
-- Deliberately no policies — reports are only ever written/read via the
-- service-role client from POST /api/ratings/[id]/report.
