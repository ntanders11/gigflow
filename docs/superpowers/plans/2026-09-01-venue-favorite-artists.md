# Venue Favorite Artists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a venue save/unsave artists to a private "My Favorites" list, reachable from Discover Artists, the artist's public profile, and a new Favorites page in the venue nav.

**Architecture:** A new single-owner `venue_favorites` table (real client-facing RLS, like `artist_blackout_dates`). A shared `lib/venues/artist-results.ts` helper builds the `ArtistResult` shape (artist + rating + favorited status) once, used by both the existing Discover Artists search and the new Favorites list endpoint, so the two surfaces can't compute ratings or favorited-state differently. A single `FavoriteButton` client component is reused in three places.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), TypeScript. No automated test suite exists in this project — verification is `npx tsc --noEmit`, `npx eslint`, `npm run build`, and manual/live checks.

**Spec:** `docs/superpowers/specs/2026-09-01-venue-favorite-artists-design.md` — read this first for the full rationale behind every decision below.

**Worktree:** `.worktrees/venue-favorite-artists`, branch `feature/venue-favorite-artists`, based on `main`. All commands below assume you're already in that directory.

## Global Constraints

- `venue_favorites` gets a normal owner-only RLS policy (`auth.uid() = user_id`, `for all`) — the same pattern `artist_blackout_dates` (migration 025) established, NOT the "no policies, service-role only" pattern used by most other tables this session. `user_id` is the venue's own auth user id, stored directly on the row (not `venue_profile_id`), so the policy is a simple direct comparison with no subquery.
- A favorite is never visible to the artist, anywhere, in any form — no count, no list, nothing. Every response shape touching `venue_favorites` is scoped to the calling venue's own rows.
- Favoriting an already-favorited artist (a double-tap, or a stale UI state) must never surface an error to the venue — it's a harmless no-op.

---

## File Map

- Create: `supabase/migrations/026_venue_favorites.sql` — new table + owner RLS policy.
- Create: `lib/venues/artist-results.ts` — shared `ArtistResult` type + `buildArtistResults`.
- Modify: `app/api/venues/discover-artists/route.ts` — use the shared helper instead of its own inline rating computation; include favorited status.
- Create: `app/api/venue/favorites/route.ts` — `GET` (list), `POST` (create).
- Create: `app/api/venue/favorites/[artistUserId]/route.ts` — `DELETE`.
- Create: `components/venue/FavoriteButton.tsx` — the reusable heart toggle.
- Modify: `app/venue/discover/page.tsx` — wire `FavoriteButton` into `ArtistCard`.
- Modify: `app/profile/[id]/page.tsx` — compute and pass `initialFavorited`, render `FavoriteButton` for venue viewers.
- Create: `app/venue/favorites/page.tsx` — the "My Favorites" list.
- Modify: `components/venue/VenueNav.tsx` — add the "Favorites" link.
- Modify: `CLAUDE.md`, `CHANGELOG.md` — document the shipped feature.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/026_venue_favorites.sql`

**Interfaces:**
- Produces: table `public.venue_favorites(id, user_id, artist_user_id, created_at)`, consumed by every task from Task 3 onward.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/026_venue_favorites.sql
-- Lets a venue save artists to a private list. Like artist_blackout_dates
-- (migration 025), this gets a real client-facing RLS policy rather than
-- "no policies, service-role only" — every row is owned and written by
-- exactly one party (the venue), with no second party ever writing to it,
-- and no artist ever needs to read it at all.

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

- [ ] **Step 2: Sanity-check the pattern against its precedent**

Read `supabase/migrations/025_artist_blackout_dates.sql` one more time and confirm this migration's shape (real RLS policy, no service-role-only comment block) matches it structurally. No local database exists to test against — Taylor will run this in the Supabase SQL Editor after merge.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/026_venue_favorites.sql
git commit -m "feat: add venue favorites migration"
```

---

### Task 2: Shared artist-result helper

**Files:**
- Create: `lib/venues/artist-results.ts`

**Interfaces:**
- Consumes: `artist_profiles`, `venue_artist_ratings` tables (existing).
- Produces: `ArtistResult { user_id, display_name, genres, photo_url, avg_rating, rating_count, favorited }` and `buildArtistResults(supabase, service, artistUserIds, favoritedIds): Promise<ArtistResult[]>`, consumed by Tasks 3 and 4.

- [ ] **Step 1: Read the current inline implementation this replaces**

Read `app/api/venues/discover-artists/route.ts` in full (already read once during this plan's design — re-confirm it hasn't changed) — the `ArtistResult` type at the top, and the artist-fetch + rating-aggregation block starting at `const { data: artists, error: artistsError } = await supabase...` through the `matchingGenre`/`other` loop. This task extracts the artist-fetch-and-rating-join part of that block (NOT the genre-tiering part, which is specific to that route and stays there).

- [ ] **Step 2: Write the helper**

```typescript
// lib/venues/artist-results.ts
import { SupabaseClient } from "@supabase/supabase-js";

export type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
  avg_rating: number | null;
  rating_count: number;
  favorited: boolean;
};

// Builds full ArtistResult objects for a set of artist_profiles rows,
// joining in each artist's mutual-rating average and whether the calling
// venue has favorited them. Shared by GET /api/venues/discover-artists
// and GET /api/venue/favorites so both surfaces compute ratings and
// favorited-status identically — they can't quietly drift apart.
export async function buildArtistResults(
  supabase: SupabaseClient,  // RLS-scoped — artist_profiles has a public-read policy
  service: SupabaseClient,   // service-role — venue_artist_ratings has no policies of its own
  artistUserIds: string[],
  favoritedIds: Set<string>
): Promise<ArtistResult[]> {
  if (artistUserIds.length === 0) return [];

  const { data: artists, error: artistsError } = await supabase
    .from("artist_profiles")
    .select("user_id, display_name, genres, photo_url")
    .in("user_id", artistUserIds);
  if (artistsError) throw new Error(artistsError.message);

  const { data: ratingRows } = await service
    .from("venue_artist_ratings")
    .select("artist_user_id, venue_stars")
    .in("artist_user_id", artistUserIds)
    .not("venue_rated_at", "is", null)
    .not("artist_rated_at", "is", null);

  const ratingsByArtist = new Map<string, number[]>();
  for (const row of ratingRows ?? []) {
    const list = ratingsByArtist.get(row.artist_user_id as string) ?? [];
    list.push(row.venue_stars as number);
    ratingsByArtist.set(row.artist_user_id as string, list);
  }

  const results: ArtistResult[] = [];
  for (const artist of artists ?? []) {
    if (!artist.display_name) continue; // onboarding not complete — not a real artist yet
    const artistUserId = artist.user_id as string;
    const stars = ratingsByArtist.get(artistUserId) ?? [];
    results.push({
      user_id: artistUserId,
      display_name: artist.display_name as string,
      genres: (artist.genres as string[] | null) ?? [],
      photo_url: artist.photo_url as string | null,
      avg_rating: stars.length > 0 ? stars.reduce((a, b) => a + b, 0) / stars.length : null,
      rating_count: stars.length,
      favorited: favoritedIds.has(artistUserId),
    });
  }
  return results;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (nothing imports this file yet).

- [ ] **Step 4: Commit**

```bash
git add lib/venues/artist-results.ts
git commit -m "feat: add shared artist-result builder with favorited status"
```

---

### Task 3: Wire the shared helper into Discover Artists

**Files:**
- Modify: `app/api/venues/discover-artists/route.ts`

**Interfaces:**
- Consumes: `buildArtistResults`, `ArtistResult` (Task 2), `venue_favorites` table (Task 1).
- Produces: no change to this route's top-level response shape (`{ matchingGenre, other, venueHasGenres }`) — each entry inside `matchingGenre`/`other` now additionally carries `favorited: boolean`.

- [ ] **Step 1: Remove the local `ArtistResult` type and add the import**

Find (top of file):
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { geocodeCity } from "@/lib/geocoding";

type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
  avg_rating: number | null;
  rating_count: number;
};
```
Replace with:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { geocodeCity } from "@/lib/geocoding";
import { buildArtistResults, ArtistResult } from "@/lib/venues/artist-results";
```

- [ ] **Step 2: Fetch the venue's own favorited ids, and replace the artist-fetch + rating block with the shared helper**

Find:
```typescript
  // artist_profiles already has a public-read RLS policy (the same one
  // that powers the public /profile/[id] page anyone can already view), so
  // this join goes through the venue's own ordinary session — no
  // service-role needed here, unlike the zones read above.
  const { data: artists, error: artistsError } = await supabase
    .from("artist_profiles")
    .select("user_id, display_name, genres, photo_url")
    .in("user_id", nearbyUserIds);

  if (artistsError) return NextResponse.json({ error: artistsError.message }, { status: 500 });

  const artistUserIdsForRatings = (artists ?? []).map((a) => a.user_id as string);
  // venue_artist_ratings has no client-facing RLS policies — this read MUST
  // use `service` (already in scope earlier in this file), not `supabase`
  // (the venue's own RLS session), or it will silently return zero rows.
  const { data: ratingRows } = await service
    .from("venue_artist_ratings")
    .select("artist_user_id, venue_stars")
    .in("artist_user_id", artistUserIdsForRatings.length > 0 ? artistUserIdsForRatings : [""])
    .not("venue_rated_at", "is", null)
    .not("artist_rated_at", "is", null);

  const ratingsByArtist = new Map<string, number[]>();
  for (const row of ratingRows ?? []) {
    const list = ratingsByArtist.get(row.artist_user_id as string) ?? [];
    list.push(row.venue_stars as number);
    ratingsByArtist.set(row.artist_user_id as string, list);
  }

  const matchingGenre: ArtistResult[] = [];
  const other: ArtistResult[] = [];

  for (const artist of artists ?? []) {
    if (!artist.display_name) continue; // onboarding not complete — not a real artist yet
    const stars = ratingsByArtist.get(artist.user_id) ?? [];
    const result: ArtistResult = {
      user_id: artist.user_id,
      display_name: artist.display_name,
      genres: artist.genres ?? [],
      photo_url: artist.photo_url,
      avg_rating: stars.length > 0 ? stars.reduce((a, b) => a + b, 0) / stars.length : null,
      rating_count: stars.length,
    };
    const artistGenres = new Set(result.genres.map(normalizeGenre));
    const hasMatch = venueHasGenres && [...artistGenres].some((g) => venueGenres.has(g));
    (hasMatch ? matchingGenre : other).push(result);
  }

  return NextResponse.json({ matchingGenre, other, venueHasGenres });
```
Replace with:
```typescript
  // venue_favorites has a real owner-only RLS policy (see migration 026),
  // so this is a plain read through the venue's own session — no
  // service-role needed, unlike the zones/ratings reads elsewhere here.
  const { data: favoriteRows } = await supabase
    .from("venue_favorites")
    .select("artist_user_id")
    .eq("user_id", user.id);
  const favoritedIds = new Set((favoriteRows ?? []).map((r) => r.artist_user_id as string));

  let results: ArtistResult[];
  try {
    results = await buildArtistResults(supabase, service, nearbyUserIds, favoritedIds);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load artists" }, { status: 500 });
  }

  const matchingGenre: ArtistResult[] = [];
  const other: ArtistResult[] = [];

  for (const result of results) {
    const artistGenres = new Set(result.genres.map(normalizeGenre));
    const hasMatch = venueHasGenres && [...artistGenres].some((g) => venueGenres.has(g));
    (hasMatch ? matchingGenre : other).push(result);
  }

  return NextResponse.json({ matchingGenre, other, venueHasGenres });
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: one new error, in `app/venue/discover/page.tsx`, because its local `ArtistResult` type doesn't yet have `favorited` and its `ArtistCard` doesn't accept it — expected, Task 6 fixes it. Confirm no *other* errors appear.

Run: `npx eslint app/api/venues/discover-artists/`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/venues/discover-artists/route.ts
git commit -m "feat: include favorited status in Discover Artists results"
```

---

### Task 4: Favorites CRUD API

**Files:**
- Create: `app/api/venue/favorites/route.ts` (`GET`, `POST`)
- Create: `app/api/venue/favorites/[artistUserId]/route.ts` (`DELETE`)

**Interfaces:**
- Consumes: `buildArtistResults` (Task 2), `venue_favorites` table (Task 1).
- Produces: `GET /api/venue/favorites` → `{ favorites: ArtistResult[] }`; `POST /api/venue/favorites` → `{ success: true }`; `DELETE /api/venue/favorites/[artistUserId]` → `{ success: true }`. Consumed by Task 6 (Discover Artists toggle), Task 7 (profile page toggle), Task 8 (Favorites page).

- [ ] **Step 1: Write `app/api/venue/favorites/route.ts`**

```typescript
// app/api/venue/favorites/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buildArtistResults } from "@/lib/venues/artist-results";

// The venue's own favorited artists, as full ArtistResult objects (same
// shape Discover Artists returns) — every entry here is favorited by
// definition, so the Set passed to buildArtistResults is just "all of them".
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: favoriteRows, error } = await supabase
    .from("venue_favorites")
    .select("artist_user_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const artistUserIds = (favoriteRows ?? []).map((r) => r.artist_user_id as string);
  const favoritedIds = new Set(artistUserIds);

  const service = await createServiceClient();
  let favorites;
  try {
    favorites = await buildArtistResults(supabase, service, artistUserIds, favoritedIds);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load favorites" }, { status: 500 });
  }

  return NextResponse.json({ favorites });
}

// Saves an artist to the venue's favorites. Idempotent: favoriting an
// already-favorited artist is a harmless no-op, never an error — a
// double-tap or a stale UI state should never surface a scary message
// for something this low-stakes.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { artist_user_id } = body;
  if (!artist_user_id) {
    return NextResponse.json({ error: "artist_user_id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("venue_favorites")
    .insert({ user_id: user.id, artist_user_id });

  // Postgres unique_violation — already favorited. Treat as success.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Write `app/api/venue/favorites/[artistUserId]/route.ts`**

```typescript
// app/api/venue/favorites/[artistUserId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ artistUserId: string }> }
) {
  const { artistUserId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The RLS policy already scopes this to the caller's own rows; the
  // explicit .eq("user_id", ...) below is defense-in-depth, matching this
  // codebase's usual style (e.g. DELETE /api/blackout-dates/[id]).
  const { error } = await supabase
    .from("venue_favorites")
    .delete()
    .eq("user_id", user.id)
    .eq("artist_user_id", artistUserId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error from Task 3, nothing new.

Run: `npx eslint app/api/venue/favorites/`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/venue/favorites/
git commit -m "feat: add venue favorites CRUD API"
```

---

### Task 5: FavoriteButton component

**Files:**
- Create: `components/venue/FavoriteButton.tsx`

**Interfaces:**
- Consumes: `POST /api/venue/favorites`, `DELETE /api/venue/favorites/[artistUserId]` (Task 4).
- Produces: `<FavoriteButton artistUserId initialFavorited onToggle? size? stopClickPropagation? />`, consumed by Tasks 6, 7, 8.

- [ ] **Step 1: Write the component**

```typescript
// components/venue/FavoriteButton.tsx
"use client";

import { useState } from "react";

// A heart toggle reused in three places: Discover Artists result cards,
// the artist's public profile page (venue viewers only), and the
// Favorites list itself. `stopClickPropagation` is needed only where this
// button sits inside a whole-card <Link> (Discover Artists, Favorites
// list) — without it, tapping the heart would also navigate to the
// artist's profile.
export default function FavoriteButton({
  artistUserId,
  initialFavorited,
  onToggle,
  size = 18,
  stopClickPropagation = false,
}: {
  artistUserId: string;
  initialFavorited: boolean;
  onToggle?: (favorited: boolean) => void;
  size?: number;
  stopClickPropagation?: boolean;
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [saving, setSaving] = useState(false);

  async function toggle(e: React.MouseEvent) {
    if (stopClickPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (saving) return;
    setSaving(true);

    const next = !favorited;
    setFavorited(next); // optimistic — this is a low-stakes toggle, no need to wait

    const res = next
      ? await fetch("/api/venue/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artist_user_id: artistUserId }),
        })
      : await fetch(`/api/venue/favorites/${artistUserId}`, { method: "DELETE" });

    setSaving(false);
    if (!res.ok) {
      setFavorited(!next); // roll back on failure
      return;
    }
    onToggle?.(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={favorited ? "Remove from favorites" : "Save to favorites"}
      title={favorited ? "Remove from favorites" : "Save to favorites"}
      className="flex items-center justify-center transition-all hover:brightness-125"
      style={{ width: `${size + 10}px`, height: `${size + 10}px`, opacity: saving ? 0.6 : 1 }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill={favorited ? "#D4A64F" : "none"} stroke="#D4A64F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error from Task 3, nothing new — this file isn't imported anywhere yet.

- [ ] **Step 3: Commit**

```bash
git add components/venue/FavoriteButton.tsx
git commit -m "feat: add reusable FavoriteButton component"
```

---

### Task 6: Wire favoriting into Discover Artists

**Files:**
- Modify: `app/venue/discover/page.tsx`

**Interfaces:**
- Consumes: `ArtistResult` (now including `favorited`) from Task 3's API response, `FavoriteButton` (Task 5).

- [ ] **Step 1: Replace the local `ArtistResult` type with the shared one, and add the button to `ArtistCard`**

Find:
```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import VenueNav from "@/components/venue/VenueNav";

type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
  avg_rating: number | null;
  rating_count: number;
};

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#F4E8D2",
};

function ArtistCard({ artist }: { artist: ArtistResult }) {
  return (
    <Link
      href={`/profile/${artist.user_id}`}
      className="rounded-xl p-4 flex items-center gap-3 transition-all hover:brightness-110"
      style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {artist.photo_url ? (
        <img src={artist.photo_url} alt={artist.display_name} className="w-11 h-11 rounded-full object-cover shrink-0" />
      ) : (
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold shrink-0"
          style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
        >
          {artist.display_name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: "#F4E8D2" }}>{artist.display_name}</div>
        <div className="text-xs truncate" style={{ color: "#9a9591" }}>{artist.genres.join(" · ") || "—"}</div>
        {artist.rating_count > 0 && (
          <div className="text-xs mt-0.5" style={{ color: "#D4A64F" }}>
            {"★".repeat(Math.round(artist.avg_rating ?? 0))}{"☆".repeat(5 - Math.round(artist.avg_rating ?? 0))}{" "}
            {artist.avg_rating?.toFixed(1)} ({artist.rating_count})
          </div>
        )}
      </div>
    </Link>
  );
}
```
Replace with:
```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import VenueNav from "@/components/venue/VenueNav";
import FavoriteButton from "@/components/venue/FavoriteButton";
import { ArtistResult } from "@/lib/venues/artist-results";

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#F4E8D2",
};

function ArtistCard({ artist }: { artist: ArtistResult }) {
  return (
    <Link
      href={`/profile/${artist.user_id}`}
      className="relative rounded-xl p-4 flex items-center gap-3 transition-all hover:brightness-110"
      style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="absolute top-2 right-2">
        <FavoriteButton artistUserId={artist.user_id} initialFavorited={artist.favorited} stopClickPropagation size={16} />
      </div>
      {artist.photo_url ? (
        <img src={artist.photo_url} alt={artist.display_name} className="w-11 h-11 rounded-full object-cover shrink-0" />
      ) : (
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold shrink-0"
          style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
        >
          {artist.display_name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 pr-6">
        <div className="text-sm font-semibold truncate" style={{ color: "#F4E8D2" }}>{artist.display_name}</div>
        <div className="text-xs truncate" style={{ color: "#9a9591" }}>{artist.genres.join(" · ") || "—"}</div>
        {artist.rating_count > 0 && (
          <div className="text-xs mt-0.5" style={{ color: "#D4A64F" }}>
            {"★".repeat(Math.round(artist.avg_rating ?? 0))}{"☆".repeat(5 - Math.round(artist.avg_rating ?? 0))}{" "}
            {artist.avg_rating?.toFixed(1)} ({artist.rating_count})
          </div>
        )}
      </div>
    </Link>
  );
}
```

Note the added `pr-6` on the text container — makes room so the absolutely-positioned heart button in the top-right corner doesn't overlap a long artist name at narrow widths.

- [ ] **Step 2: Verify it compiles clean**

Run: `npx tsc --noEmit`
Expected: **no errors at all** — this was the last file with the pending error from Task 3.

Run: `npx eslint app/venue/discover/`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/venue/discover/page.tsx
git commit -m "feat: add favorite toggle to Discover Artists result cards"
```

---

### Task 7: Wire favoriting into the public artist profile page

**Files:**
- Modify: `app/profile/[id]/page.tsx`

**Interfaces:**
- Consumes: `venue_favorites` table (Task 1), `FavoriteButton` (Task 5).

- [ ] **Step 1: Compute `initialFavorited` alongside the existing `viewerType` resolution**

Find:
```typescript
  const authSupabase = await createClient();
  const { data: { user: viewer } } = await authSupabase.auth.getUser();
  let viewerType: "venue" | "artist" | "other" = "other";
  if (viewer) {
    const { data: viewerVenueProfile } = await authSupabase
      .from("venue_profiles")
      .select("venue_name")
      .eq("user_id", viewer.id)
      .maybeSingle();
    if (viewerVenueProfile?.venue_name) {
      viewerType = "venue";
    } else {
      const { data: viewerArtistProfile } = await authSupabase
        .from("artist_profiles")
        .select("display_name")
        .eq("user_id", viewer.id)
        .maybeSingle();
      if (viewerArtistProfile?.display_name) viewerType = "artist";
    }
  }
  const backHref = viewerType === "venue" ? "/venue/bookings" : viewerType === "artist" ? "/dashboard" : "/venues";
```
Replace with:
```typescript
  const authSupabase = await createClient();
  const { data: { user: viewer } } = await authSupabase.auth.getUser();
  let viewerType: "venue" | "artist" | "other" = "other";
  if (viewer) {
    const { data: viewerVenueProfile } = await authSupabase
      .from("venue_profiles")
      .select("venue_name")
      .eq("user_id", viewer.id)
      .maybeSingle();
    if (viewerVenueProfile?.venue_name) {
      viewerType = "venue";
    } else {
      const { data: viewerArtistProfile } = await authSupabase
        .from("artist_profiles")
        .select("display_name")
        .eq("user_id", viewer.id)
        .maybeSingle();
      if (viewerArtistProfile?.display_name) viewerType = "artist";
    }
  }
  const backHref = viewerType === "venue" ? "/venue/bookings" : viewerType === "artist" ? "/dashboard" : "/venues";

  // venue_favorites has a real owner-only RLS policy (migration 026) — a
  // plain read through the viewer's own session, only meaningful when
  // they're actually a venue (viewerType check keeps this a no-op query
  // for an artist or logged-out visitor).
  let initialFavorited = false;
  if (viewerType === "venue" && viewer) {
    const { data: favoriteRow } = await authSupabase
      .from("venue_favorites")
      .select("id")
      .eq("user_id", viewer.id)
      .eq("artist_user_id", id)
      .maybeSingle();
    initialFavorited = !!favoriteRow;
  }
```

- [ ] **Step 2: Add the import and render the button next to Request to Book**

Find:
```typescript
import { InstagramIcon, SpotifyIcon, YouTubeIcon, WebsiteIcon } from "@/components/icons/SocialIcons";
import { getEmbedUrl } from "@/lib/embeds";
```
Replace with:
```typescript
import { InstagramIcon, SpotifyIcon, YouTubeIcon, WebsiteIcon } from "@/components/icons/SocialIcons";
import { getEmbedUrl } from "@/lib/embeds";
import FavoriteButton from "@/components/venue/FavoriteButton";
```

Find:
```typescript
        {/* Book button */}
        <div className="mb-6">
          <RequestToBookButton artistUserId={id} viewerType={viewerType} />
        </div>
```
Replace with:
```typescript
        {/* Book button, plus a favorite toggle for venue viewers only */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex-1">
            <RequestToBookButton artistUserId={id} viewerType={viewerType} />
          </div>
          {viewerType === "venue" && (
            <div
              className="rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <FavoriteButton artistUserId={id} initialFavorited={initialFavorited} size={20} />
            </div>
          )}
        </div>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint app/profile/`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/profile/[id]/page.tsx"
git commit -m "feat: add favorite toggle to the public artist profile page"
```

---

### Task 8: My Favorites page and nav link

**Files:**
- Create: `app/venue/favorites/page.tsx`
- Modify: `components/venue/VenueNav.tsx`

**Interfaces:**
- Consumes: `GET /api/venue/favorites` (Task 4), `ArtistResult` (Task 2/3).

- [ ] **Step 1: Write the Favorites page**

This mirrors `app/venue/discover/page.tsx`'s result-grid rendering (same `ArtistCard`-shaped presentation, reusing the exact same component), but fetches from the favorites endpoint instead of running a search.

```typescript
// app/venue/favorites/page.tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import VenueNav from "@/components/venue/VenueNav";
import FavoriteButton from "@/components/venue/FavoriteButton";
import { ArtistResult } from "@/lib/venues/artist-results";

function FavoriteCard({ artist, onRemoved }: { artist: ArtistResult; onRemoved: (id: string) => void }) {
  return (
    <Link
      href={`/profile/${artist.user_id}`}
      className="relative rounded-xl p-4 flex items-center gap-3 transition-all hover:brightness-110"
      style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="absolute top-2 right-2">
        <FavoriteButton
          artistUserId={artist.user_id}
          initialFavorited={true}
          stopClickPropagation
          size={16}
          onToggle={(favorited) => { if (!favorited) onRemoved(artist.user_id); }}
        />
      </div>
      {artist.photo_url ? (
        <img src={artist.photo_url} alt={artist.display_name} className="w-11 h-11 rounded-full object-cover shrink-0" />
      ) : (
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold shrink-0"
          style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
        >
          {artist.display_name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 pr-6">
        <div className="text-sm font-semibold truncate" style={{ color: "#F4E8D2" }}>{artist.display_name}</div>
        <div className="text-xs truncate" style={{ color: "#9a9591" }}>{artist.genres.join(" · ") || "—"}</div>
        {artist.rating_count > 0 && (
          <div className="text-xs mt-0.5" style={{ color: "#D4A64F" }}>
            {"★".repeat(Math.round(artist.avg_rating ?? 0))}{"☆".repeat(5 - Math.round(artist.avg_rating ?? 0))}{" "}
            {artist.avg_rating?.toFixed(1)} ({artist.rating_count})
          </div>
        )}
      </div>
    </Link>
  );
}

export default function VenueFavoritesPage() {
  const [favorites, setFavorites] = useState<ArtistResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/venue/favorites")
      .then((r) => (r.ok ? r.json() : { favorites: [] }))
      .then((data) => setFavorites(data.favorites ?? []))
      .finally(() => setLoading(false));
  }, []);

  function handleRemoved(artistUserId: string) {
    setFavorites((prev) => prev.filter((a) => a.user_id !== artistUserId));
  }

  return (
    <>
      <VenueNav />
      <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <h1 className="text-2xl font-bold mb-6" style={{ color: "#F4E8D2" }}>My Favorites</h1>

          {loading ? (
            <div className="text-center py-16">
              <p className="text-sm" style={{ color: "#5e5c58" }}>Loading…</p>
            </div>
          ) : favorites.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm font-medium mb-2" style={{ color: "#5e5c58" }}>No favorites yet.</p>
              <p className="text-sm">
                <Link href="/venue/discover" style={{ color: "#D4A64F" }}>Discover Artists →</Link>
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {favorites.map((a) => (
                <FavoriteCard key={a.user_id} artist={a} onRemoved={handleRemoved} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add the nav link**

Find:
```typescript
const links = [
  { href: "/venue/profile", label: "My Profile" },
  { href: "/venue/discover", label: "Discover Artists" },
  { href: "/venue/bookings", label: "Bookings" },
  { href: "/venue/ratings", label: "Ratings" },
];
```
Replace with:
```typescript
const links = [
  { href: "/venue/profile", label: "My Profile" },
  { href: "/venue/discover", label: "Discover Artists" },
  { href: "/venue/favorites", label: "Favorites" },
  { href: "/venue/bookings", label: "Bookings" },
  { href: "/venue/ratings", label: "Ratings" },
];
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint app/venue/favorites/ components/venue/VenueNav.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/venue/favorites/ components/venue/VenueNav.tsx
git commit -m "feat: add My Favorites page and nav link"
```

---

### Task 9: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a `venue_favorites` bullet to CLAUDE.md's Core Data Model list**

Insert after the `artist_blackout_dates` bullet:

> - venue_favorites — a venue's private, saved list of artists they want to remember (no note, no category — just a save/unsave toggle). Like `artist_blackout_dates`, uses a normal client-facing RLS policy (owner-only) rather than "no policies, service-role only," since only the venue that saved a favorite ever reads or writes it. Never visible to the artist in any form. See `lib/venues/artist-results.ts`.

- [ ] **Step 2: Add a paragraph to CLAUDE.md's Key Flows section**

Insert after the existing "Blackout Dates" paragraph:

> Venue Favorites — a venue can save any artist to a private list from three places: Discover Artists result cards, the artist's public profile page, and the list itself at `/venue/favorites` (a new `VenueNav` link). All three use one shared `FavoriteButton` component and go through `GET`/`POST /api/venue/favorites` and `DELETE /api/venue/favorites/[artistUserId]`. A shared `lib/venues/artist-results.ts` (`buildArtistResults`) computes the artist-plus-rating-plus-favorited shape once, used by both `GET /api/venues/discover-artists` and `GET /api/venue/favorites`, so the two surfaces can't compute ratings or favorited-state differently. Never surfaced to the artist in any form — no count, no list, nothing.

- [ ] **Step 3: Add a CHANGELOG.md entry**

Read `CHANGELOG.md`'s current top entry first to match its formatting exactly, then add a new dated section for today (check the actual current date):

```
## 2026-09-01 (venue favorite artists)
- [Feature] Venues can now save artists to a private "Favorites" list — a heart icon on Discover Artists cards and on an artist's public profile. Find your saved artists anytime from the new "Favorites" tab. Completely private — artists never see who's favorited them.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document venue favorite artists"
```

---

### Task 10: Full verification and manual test

**Files:** none (verification only)

- [ ] **Step 1: Full project build**

Run: `npm run build`
Expected: builds successfully with no errors. (If a fresh worktree, `.env.local` must be copied from the main repo first — it's gitignored and worktrees don't inherit it.)

- [ ] **Step 2: Lint**

Run: `npx eslint .`
Expected: no new errors compared to `main`'s pre-existing baseline (a small number of known pre-existing lint errors exist, none in files this plan touches — confirm that remains true).

- [ ] **Step 3: Live manual test, if a real venue test account is available**

Taylor has a real venue test account used throughout this session. Walk through:

1. Go to `/venue/discover`, search, and tap the heart on an artist card. Confirm it fills in immediately.
2. Go to `/venue/favorites` (new nav link). Confirm that artist appears.
3. Open that same artist's public profile (`/profile/[id]`). Confirm the heart there also shows as favorited (state agrees across all three surfaces).
4. Un-favorite from the profile page. Confirm it disappears from `/venue/favorites` on next load, and Discover Artists shows the heart empty again on next load.
5. Favorite the same artist twice in a row quickly (double-tap) — confirm no error, no duplicate entry.
6. Log in as the artist test account and confirm there is no visible indication anywhere (profile page, dashboard, notifications) that they've been favorited.

- [ ] **Step 4: If a live test isn't practical in this environment**

Fall back to static verification only: confirm the build is clean (Steps 1–2 above), and manually re-trace the three `FavoriteButton` usages (Discover Artists, profile page, Favorites page) against the API contract from Task 4 to catch anything a live click-through would have caught. Report clearly to Taylor that full live end-to-end testing still needs to happen after this ships.

- [ ] **Step 5: Report the migration to Taylor**

Whichever path was taken above, remind Taylor that `supabase/migrations/026_venue_favorites.sql` still needs to be run manually in the Supabase SQL Editor before any of this works in production.
