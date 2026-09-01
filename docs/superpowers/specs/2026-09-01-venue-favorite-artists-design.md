# Venue Favorite Artists — Design

## Overview

The first of three retention-focused features (favorites, "book again" shortcut, payment history — each its own design/build cycle). Venues can save artists they've found — via Discover Artists or an artist's public profile — to a private "My Favorites" list, reachable from their own nav. Nothing about this is visible to the artist; it's a bookmark for the venue only, not a mutual-visibility feature like ratings.

## Data Model

New migration `supabase/migrations/026_venue_favorites.sql`:

```sql
create table public.venue_favorites (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  artist_user_id  uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),

  unique (user_id, artist_user_id)
);

create index idx_venue_favorites_user_id on public.venue_favorites(user_id);

alter table public.venue_favorites enable row level security;

create policy "Venues manage their own favorites"
  on public.venue_favorites
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

`user_id` is the venue's own auth user id (matching `auth.uid()` directly), not `venue_profile_id` — this keeps the RLS policy a simple direct comparison, the same shape as `artist_blackout_dates` (migration `025`), rather than needing a subquery through `venue_profiles`. Like that table, this is single-owner data (only the venue that created a favorite ever reads or writes it) with no second party ever needing restricted access, so it gets a real client-facing RLS policy rather than the "no policies, service-role only" pattern used by `booking_requests`/`venue_artist_ratings`/`notifications`/`push_subscriptions`.

The `unique (user_id, artist_user_id)` constraint means favoriting an already-favorited artist is a conflict, not a duplicate row — the API layer treats that as a harmless no-op (see below), not an error surfaced to the venue.

## Shared Artist-Result Helper

`app/api/venues/discover-artists/route.ts` already builds `ArtistResult[]` objects (`user_id`, `display_name`, `genres`, `photo_url`, `avg_rating`, `rating_count`) by joining `artist_profiles` against `venue_artist_ratings`. The new favorites-list endpoint needs the identical computation for a different, smaller set of artist ids (the venue's saved ones, not a geocoded radius search).

Extract this into `lib/venues/artist-results.ts`:

```typescript
export type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
  avg_rating: number | null;
  rating_count: number;
  favorited: boolean;
};

export async function buildArtistResults(
  supabase: SupabaseClient,   // RLS-scoped — artist_profiles has public read
  service: SupabaseClient,    // service-role — venue_artist_ratings has no policies
  artistUserIds: string[],
  favoritedIds: Set<string>
): Promise<ArtistResult[]>
```

Both `discover-artists` and the new favorites-list route call this, so the rating computation and the shape of `favorited` can't drift between the two surfaces.

`favorited` is new on `ArtistResult` — set from a `favoritedIds` Set the caller already has (each route computes this differently: `discover-artists` reads the venue's own favorites once up front and passes the Set in; the favorites-list route already knows every returned artist is favorited, so it passes a Set of exactly the ids being returned). `ArtistCard` (Discover Artists' UI) needs one new prop, `favorited: boolean`, and a `FavoriteButton` rendered inside it.

## New API Routes

- `GET /api/venue/favorites` — the venue's own favorited artists, as full `ArtistResult[]` (via `buildArtistResults`). RLS-scoped `createClient()` for reading `venue_favorites` (real owner policy); `createServiceClient()` only for the ratings join inside `buildArtistResults`, same reasoning as `discover-artists` today.
- `POST /api/venue/favorites` — body `{ artist_user_id }`. Inserts via the RLS-scoped client (ownership automatic). If the insert fails on the unique constraint (already favorited), treat as success — return the existing state rather than an error, so a double-tap or a stale UI never surfaces a scary message for a harmless action.
- `DELETE /api/venue/favorites/[artistUserId]` — removes the caller's own favorite row for that artist (RLS-scoped, keyed on `artist_user_id` rather than the favorite row's own `id`, since that's what the toggle button already knows — no extra lookup needed).

## UI

**`FavoriteButton`** (new client component, `components/venue/FavoriteButton.tsx`): a small heart icon, filled when favorited, outline when not. Props: `artistUserId`, `initialFavorited`, optional `onToggle`. Handles its own POST/DELETE and local toggle state. Used in three places:

1. **`ArtistCard`** (`app/venue/discover/page.tsx`) — top-right corner of the card, alongside where the "⭐ On StageReach" badge sits on pipeline cards elsewhere in the app for visual precedent. Since `ArtistCard` is currently a `<Link>` wrapping the whole card, the button's click handler needs `preventDefault`/`stopPropagation` so tapping the heart doesn't also navigate to the profile — the same pattern `VenueCard.tsx`'s inline action buttons already use.
2. **Public artist profile page** (`app/profile/[id]/page.tsx`) — next to the existing `RequestToBookButton`, shown only when `viewerType === "venue"` (the page already resolves this server-side; it additionally checks `venue_favorites` for this artist+viewer to compute `initialFavorited`, passed as a prop — no extra client round-trip).
3. **New "My Favorites" page** (`app/venue/favorites/page.tsx`) — reuses `ArtistCard` in the same grid layout Discover Artists already uses, fetching from `GET /api/venue/favorites`. Empty state: a short message pointing back to Discover Artists.

**`VenueNav.tsx`** gets a new "Favorites" link, alongside the existing My Profile / Discover Artists / Bookings / Ratings.

## Out of Scope

- No notes or categories on a favorite — a plain save/unsave, per Taylor's explicit choice.
- No artist-side visibility of who's favorited them, or how many times — private to the venue, per Taylor's explicit choice.
- No booking-history enrichment on the Favorites page (e.g. "you booked this artist twice") — same card as Discover Artists, per Taylor's explicit choice. (This kind of enrichment is closer to the separately-planned "book this artist again" feature.)

## Manual Verification

No automated test suite in this project. Verification is `npx tsc --noEmit` / `npx eslint` / `npm run build`, plus manual/live checks:

- Venue favorites an artist from Discover Artists → heart fills in immediately, artist appears on `/venue/favorites`.
- Venue favorites the same artist again from the artist's public profile page → toggle correctly shows already-favorited state (no duplicate row, no error).
- Venue un-favorites from the Favorites page → artist disappears from the list, and Discover Artists (on next load) shows the heart as empty again.
- Artist has no way to see they've been favorited anywhere in their own UI.
- A second venue account favoriting the same artist doesn't affect the first venue's list (favorites are per-venue, not global).
