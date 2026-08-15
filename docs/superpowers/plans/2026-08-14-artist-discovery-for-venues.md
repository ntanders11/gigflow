# Artist Discovery for Venues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in venue search for real StageReach artists near them, ranked by whether the artist's genres match what the venue books, with each result linking to that artist's existing public profile page.

**Architecture:** A shared `geocodeCity` helper (extracted from the existing Discover Venues route) powers a new `GET /api/venues/discover-artists` endpoint, which geocodes artists' home zones lazily and caches the result on the `zones` table to avoid repeat Google Geocoding calls. A new `/venue/discover` page (mirroring the existing artist-side Discover Venues UI) renders the results, split into two tiers by genre match. A small nav header ties this together with the existing `/venue/profile` page as the venue's first real multi-page experience.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), TypeScript, React client components. No automated test suite exists in this project — verification is `npx tsc --noEmit` / `npx eslint`, applying the migration via the Supabase SQL Editor, and manual browser checks (including live production testing, which caught 3 real bugs during the prior venue-accounts feature that no code review alone would have found).

**Full design reference:** `docs/superpowers/specs/2026-08-14-artist-discovery-for-venues-design.md` — read this first if anything below is ambiguous.

---

### Task 1: Extract `geocodeCity` into a shared module

**Files:**
- Create: `lib/geocoding.ts`
- Modify: `app/api/venues/discover/route.ts`

This must happen first — both Task 3 (the new discover-artists endpoint) and nothing else in this plan works without it, and the existing Discover Venues route needs to keep working unchanged.

- [ ] **Step 1: Create the shared module**

Move the existing `geocodeCity` function out of `app/api/venues/discover/route.ts` verbatim — same signature, same three-provider fallback logic (Google → Geoapify → Nominatim), same 6-second timeout on each. Do not change its behavior.

```typescript
// lib/geocoding.ts

// Geocode a city/zip string. Google first (most accurate, requires
// billing), then Geoapify (free, no billing), then Nominatim (free,
// US-restricted) as a last resort.
export async function geocodeCity(
  city: string,
  googleKey: string | undefined,
  geoapifyKey: string | undefined
): Promise<{ lat: number; lon: number } | null> {
  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&region=us&key=${googleKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = await res.json();
        const loc = data.results?.[0]?.geometry?.location;
        if (loc) return { lat: loc.lat, lon: loc.lng };
      }
    } catch { /* fall through */ }
  }

  if (geoapifyKey) {
    try {
      const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(city)}&filter=countrycode:us&limit=1&apiKey=${geoapifyKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = await res.json();
        const coords = data.features?.[0]?.geometry?.coordinates;
        if (coords) return { lat: coords[1], lon: coords[0] };
      }
    } catch { /* fall through to Nominatim */ }
  }

  // Nominatim fallback — countrycodes=us keeps it from matching
  // small localities in unexpected countries/states.
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url, {
      headers: { "User-Agent": "StageReach/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data[0]) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch { /* give up */ }

  return null;
}
```

- [ ] **Step 2: Remove the local copy from the discover route and import the shared one instead**

In `app/api/venues/discover/route.ts`, delete the entire local `geocodeCity` function (it currently sits between the `applyStageReachMatches` function and the `GET` handler), and add this import at the top of the file alongside the existing imports:

```typescript
import { geocodeCity } from "@/lib/geocoding";
```

Nothing else in that file changes — every call site (`geocodeCity(cityParam, googleKey, geoapifyKey)` etc.) keeps working identically since the signature is unchanged.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npx eslint lib/geocoding.ts "app/api/venues/discover/route.ts"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/geocoding.ts "app/api/venues/discover/route.ts"
git commit -m "refactor: extract geocodeCity into a shared module"
```

---

### Task 2: Migration — cache zone coordinates

**Files:**
- Create: `supabase/migrations/017_zones_lat_lon.sql`
- Modify: `types/index.ts`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- ZONE COORDINATES (cached)
-- Adds cached lat/lon to zones so venue-side artist search
-- doesn't have to re-geocode every artist's zone on every
-- search. Populated lazily by the search endpoint the first
-- time it encounters a zone with no cached coordinates —
-- nothing backfills existing zones up front.
-- ============================================================

alter table public.zones
  add column lat double precision,
  add column lon double precision;
```

- [ ] **Step 2: Apply the migration**

Run this file's contents in the Supabase SQL Editor — same process used for every prior migration in this project.

- [ ] **Step 3: Verify**

In the Supabase SQL Editor:

```sql
select column_name, data_type from information_schema.columns where table_name = 'zones' order by ordinal_position;
```

Expected: `lat` and `lon` both appear, type `double precision`.

- [ ] **Step 4: Update the `Zone` type**

In `types/index.ts`, find the `Zone` interface and add the two new nullable fields:

```typescript
export interface Zone {
  id: string;
  user_id: string;
  name: string;
  zip_code: string | null;
  radius_mi: number;
  lat: number | null;
  lon: number | null;
  created_at: string;
}
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/017_zones_lat_lon.sql types/index.ts
git commit -m "feat: add cached lat/lon columns to zones"
```

---

### Task 3: `GET /api/venues/discover-artists` endpoint

**Files:**
- Create: `app/api/venues/discover-artists/route.ts`

This is the core of the feature — read it carefully, this task has more moving parts than most in this plan.

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { geocodeCity } from "@/lib/geocoding";

type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
};

// Haversine distance in miles between two lat/lon points.
function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeGenre(g: string): string {
  return g.trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const city = req.nextUrl.searchParams.get("city")?.trim();
  if (!city) return NextResponse.json({ error: "city is required" }, { status: 400 });
  const radiusMi = parseInt(req.nextUrl.searchParams.get("radius") ?? "30");

  const googleKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const geoapifyKey = process.env.GEOAPIFY_API_KEY?.trim();

  const searchCoords = await geocodeCity(city, googleKey, geoapifyKey);
  if (!searchCoords) {
    return NextResponse.json({ error: "Location not found — try a different city or zip." }, { status: 400 });
  }

  // The requesting venue's own genres, for tiering results below. Read via
  // the venue's own RLS session — this is their own row, no service-role
  // needed.
  const { data: venueProfile } = await supabase
    .from("venue_profiles")
    .select("genres")
    .eq("user_id", user.id)
    .maybeSingle();
  const venueGenres = new Set((venueProfile?.genres ?? []).map(normalizeGenre));
  const venueHasGenres = venueGenres.size > 0;

  const service = await createServiceClient();

  // zones RLS scopes reads to the owning artist (auth.uid() = user_id), so
  // this cross-user read requires the service-role client — same reasoning
  // as every other cross-artist read in the venue-accounts feature before
  // this one.
  const { data: zones, error: zonesError } = await service
    .from("zones")
    .select("id, user_id, name, lat, lon")
    .limit(500);

  if (zonesError) return NextResponse.json({ error: zonesError.message }, { status: 500 });

  const alreadyCached = (zones ?? []).filter(
    (z): z is typeof z & { lat: number; lon: number } => z.lat != null && z.lon != null
  );
  const ungeocoded = (zones ?? []).filter((z) => z.lat == null || z.lon == null);

  // Geocode every zone missing cached coordinates, in parallel (each call is
  // independent), and write each result back so no future search ever
  // re-geocodes it. This caching is what keeps this feature from burning
  // through Google Geocoding's 200-calls/day project-wide cap — without it,
  // a single search would geocode the venue's own city PLUS every distinct
  // artist zone, every time.
  const newlyGeocoded = await Promise.all(
    ungeocoded.map(async (zone) => {
      const coords = await geocodeCity(zone.name, googleKey, geoapifyKey);
      if (!coords) return null;
      const { error: updateError } = await service
        .from("zones")
        .update({ lat: coords.lat, lon: coords.lon })
        .eq("id", zone.id);
      if (updateError) {
        console.error("discover-artists: failed to cache zone coordinates", updateError);
      }
      return { user_id: zone.user_id as string, lat: coords.lat, lon: coords.lon };
    })
  );

  const zonesWithCoords = [
    ...alreadyCached.map((z) => ({ user_id: z.user_id as string, lat: z.lat, lon: z.lon })),
    ...newlyGeocoded.filter((z): z is { user_id: string; lat: number; lon: number } => z !== null),
  ];

  const nearbyUserIds = Array.from(
    new Set(
      zonesWithCoords
        .filter((z) => distanceMiles(searchCoords.lat, searchCoords.lon, z.lat, z.lon) <= radiusMi)
        .map((z) => z.user_id)
    )
  );

  if (nearbyUserIds.length === 0) {
    return NextResponse.json({ matchingGenre: [], other: [], venueHasGenres });
  }

  // artist_profiles already has a public-read RLS policy (the same one
  // that powers the public /profile/[id] page anyone can already view), so
  // this join goes through the venue's own ordinary session — no
  // service-role needed here, unlike the zones read above.
  const { data: artists, error: artistsError } = await supabase
    .from("artist_profiles")
    .select("user_id, display_name, genres, photo_url")
    .in("user_id", nearbyUserIds);

  if (artistsError) return NextResponse.json({ error: artistsError.message }, { status: 500 });

  const matchingGenre: ArtistResult[] = [];
  const other: ArtistResult[] = [];

  for (const artist of artists ?? []) {
    if (!artist.display_name) continue; // onboarding not complete — not a real artist yet
    const result: ArtistResult = {
      user_id: artist.user_id,
      display_name: artist.display_name,
      genres: artist.genres ?? [],
      photo_url: artist.photo_url,
    };
    const artistGenres = new Set(result.genres.map(normalizeGenre));
    const hasMatch = venueHasGenres && [...artistGenres].some((g) => venueGenres.has(g));
    (hasMatch ? matchingGenre : other).push(result);
  }

  return NextResponse.json({ matchingGenre, other, venueHasGenres });
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint app/api/venues/discover-artists/route.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/venues/discover-artists/route.ts
git commit -m "feat: add venue-side artist search endpoint"
```

---

### Task 4: `/venue/discover` page

**Files:**
- Create: `app/venue/discover/page.tsx`

Mirrors `components/discover/DiscoverView.tsx`'s search-control pattern (location input + radius slider + auto-search on mount), but simpler — no bulk-add, no selection mode, no per-card action buttons, since this piece's only action is linking out to an artist's existing profile.

- [ ] **Step 1: Write the page**

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
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
      </div>
    </Link>
  );
}

export default function VenueDiscoverPage() {
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(30);
  const [matchingGenre, setMatchingGenre] = useState<ArtistResult[]>([]);
  const [other, setOther] = useState<ArtistResult[]>([]);
  const [venueHasGenres, setVenueHasGenres] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async (searchCity: string, searchRadius: number) => {
    if (!searchCity.trim()) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ city: searchCity.trim(), radius: String(searchRadius) });
      const res = await fetch(`/api/venues/discover-artists?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't search right now — please try again.");
        return;
      }
      const data = await res.json();
      setMatchingGenre(data.matchingGenre ?? []);
      setOther(data.other ?? []);
      setVenueHasGenres(!!data.venueHasGenres);
      setSearched(true);
    } catch {
      setError("Couldn't search right now — please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-search on mount using the venue's own city, same pattern the
  // artist-side Discover Venues page already uses with the artist's home
  // zone.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/venue-profile");
        if (res.ok) {
          const profile = await res.json();
          if (profile?.city) {
            setCity(profile.city);
            runSearch(profile.city, 30);
          }
        }
      } catch {
        // No connectivity to check — venue can still search manually.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    runSearch(city, radius);
  }

  const combined = venueHasGenres ? null : [...matchingGenre, ...other];

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Discover Artists</h1>

      <form onSubmit={handleSearch} className="rounded-xl p-5 mb-6" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>Location</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City, state or zip code"
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <div style={{ width: "130px" }}>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>Radius: {radius} mi</label>
            <input
              type="range"
              min={2}
              max={50}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="w-full mt-1"
              style={{ accentColor: "#D4A64F", marginTop: "10px" }}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
          style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: loading ? 0.7 : 1 }}
        >
          {loading ? "Searching…" : "Search Artists"}
        </button>
        {error && <p className="mt-3 text-sm" style={{ color: "#e25c5c" }}>{error}</p>}
      </form>

      {loading && (
        <div className="text-center py-16">
          <p className="text-sm" style={{ color: "#5e5c58" }}>Searching for artists…</p>
        </div>
      )}

      {searched && !loading && (
        <>
          {matchingGenre.length === 0 && other.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm font-medium" style={{ color: "#5e5c58" }}>No artists found in this area yet.</p>
            </div>
          ) : combined ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#9a9591" }}>
                Artists in your area
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {combined.map((a) => <ArtistCard key={a.user_id} artist={a} />)}
              </div>
            </div>
          ) : (
            <>
              {matchingGenre.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#9a9591" }}>
                    Matches your genres
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {matchingGenre.map((a) => <ArtistCard key={a.user_id} artist={a} />)}
                  </div>
                </div>
              )}
              {other.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
                    Other artists nearby
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {other.map((a) => <ArtistCard key={a.user_id} artist={a} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
```

Note: `combined` is `null` when the venue has genres set (so the two-tier branch renders), or the merged array when the venue has no genres (so the flat "Artists in your area" branch renders) — this directly reflects `venueHasGenres` from the API response, not a guess based on which arrays are empty.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint app/venue/discover/page.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/venue/discover/page.tsx
git commit -m "feat: add venue-side artist discovery page"
```

---

### Task 5: Venue navigation header

**Files:**
- Create: `components/venue/VenueNav.tsx`
- Modify: `app/venue/profile/page.tsx`
- Modify: `app/venue/discover/page.tsx`

- [ ] **Step 1: Write the nav component**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/venue/profile", label: "My Profile" },
  { href: "/venue/discover", label: "Discover Artists" },
];

export default function VenueNav() {
  const pathname = usePathname();

  return (
    <nav
      className="px-6 py-3 flex items-center gap-6"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", backgroundColor: "#16181c" }}
    >
      <div style={{ fontFamily: "serif", fontSize: "1rem", color: "#D4A64F", fontWeight: 600 }}>
        StageReach
      </div>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="text-sm transition-all hover:brightness-125"
          style={{ color: pathname === link.href ? "#D4A64F" : "#9a9591", fontWeight: pathname === link.href ? 600 : 400 }}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Add it to `/venue/profile`**

In `app/venue/profile/page.tsx`, add the import:

```typescript
import VenueNav from "@/components/venue/VenueNav";
```

Find the outermost returned `<div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>` and add `<VenueNav />` as its first child, immediately after the opening tag, before the existing `<div className="max-w-2xl mx-auto ...">` content wrapper. Do not change anything else in this file.

- [ ] **Step 3: Add it to `/venue/discover`**

In `app/venue/discover/page.tsx` (from Task 4), add the same import and wrap the existing return value: change the outermost element from `<div className="max-w-4xl mx-auto px-6 py-10">` to a fragment containing `<VenueNav />` followed by a `<div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>` wrapping the existing `max-w-4xl` content — matching the same two-layer structure `/venue/profile` uses (full-height dark background, nav at the top, content padded below).

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npx eslint components/venue/VenueNav.tsx "app/venue/profile/page.tsx" "app/venue/discover/page.tsx"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/venue/VenueNav.tsx "app/venue/profile/page.tsx" "app/venue/discover/page.tsx"
git commit -m "feat: add venue navigation header"
```

---

### Task 6: Middleware — allow the new venue page through

**Files:**
- Modify: `proxy.ts`

This is required, not optional — without it, `/venue/discover` is unreachable. The venue-account redirect added during the first piece only lets through the exact path `/venue/profile`.

- [ ] **Step 1: Widen the redirect condition**

Find:

```typescript
      if (venueProfile.venue_name && pathname !== "/venue/profile") {
        const url = request.nextUrl.clone();
```

Replace with:

```typescript
      // Widened from an exact match on "/venue/profile" to a prefix match
      // on "/venue/" so new venue-facing pages (like /venue/discover) don't
      // need a middleware change each time one's added. Safe against
      // false-matching "/venues/signup" or "/venues" — those are a
      // different path segment ("/venues/", plural) entirely.
      if (venueProfile.venue_name && !pathname.startsWith("/venue/")) {
        const url = request.nextUrl.clone();
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint proxy.ts
```

Expected: no errors.

Manually trace through (no code changes needed, just confirm by reading): a fully-provisioned venue visiting `/venue/discover` → `pathname.startsWith("/venue/")` is `true` → condition is `false` → no redirect, request proceeds. A fully-provisioned venue visiting `/dashboard` (or anything else) → `startsWith("/venue/")` is `false` → redirects to `/venue/profile`, unchanged from before. An artist visiting `/venues/signup` or `/venues` is unaffected — those requests never reach this branch at all, since `venueProfile` is null for an artist account.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "fix: allow venue accounts to reach any /venue/ page, not just /venue/profile"
```

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `CLAUDE.md`'s Venue Accounts section**

Find the existing "Venue Accounts" paragraph in Key Flows and add this to the end of it (same paragraph, don't create a new heading):

```
 The second piece, artist discovery, adds `/venue/discover` — a venue-side search over StageReach's own `artist_profiles` (not an external API), reusing the same geocoding (`lib/geocoding.ts`, shared with the artist-side Discover Venues route) and the same city/radius UX. Results are split into two tiers by comparing the venue's own `genres` against each artist's `genres` (case-insensitive, trimmed) — matches first, everyone else in the searched radius below; venues with no genres set just see one flat list. Artist zone coordinates are geocoded once and cached on `zones.lat`/`zones.lon` rather than re-geocoded on every search, since Google Geocoding is capped at 200 calls/day project-wide. Each result links straight to that artist's existing public `/profile/[id]` page — no new artist-detail view was built. A new `VenueNav` header (`components/venue/VenueNav.tsx`) gives venues their first real navigation between "My Profile" and "Discover Artists".
```

- [ ] **Step 2: Add a CHANGELOG entry**

Check today's actual date first (`date +%Y-%m-%d`) and use that for the heading, following this project's convention of dating entries by when they ship, not when the plan was written — if an entry already exists for today, append `(2)` etc. to disambiguate, matching the file's existing pattern for same-day multiple entries. Add at the very top (newest-first).

```markdown
- [Feature] Venues can now search for artists near them at stagereach.app/venue/discover — results prioritize artists whose genres match what the venue books, and every result links straight to that artist's full profile to reach out.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document artist discovery for venues"
```

---

## Manual Verification (after all tasks complete)

No automated test suite exists — verify live in the browser, same discipline as the venue-accounts feature (which caught 3 real production bugs this way):

1. Confirm the migration ran (check `zones` has `lat`/`lon` columns in the Supabase dashboard) before testing anything live.
2. Log in as a venue account with `genres` set on its profile. Visit `/venue/discover` — confirm it auto-searches using the venue's own city and shows results split into "Matches your genres" / "Other artists nearby".
3. Log in as (or check) a venue account with NO genres set — confirm it shows one flat "Artists in your area" list instead.
4. Confirm each artist card links to the correct `/profile/[id]` page and that page still renders exactly as before (bio, music samples, packages, "Send Booking Inquiry" button).
5. Search a location with no nearby artists — confirm the "No artists found in this area yet" message appears, not an error.
6. Search an invalid/unrecognizable location — confirm a real error message appears, not a silent failure.
7. Check the Supabase `zones` table after a search — confirm previously-null `lat`/`lon` values got populated for any artist zones that matched the search, and that a second identical search doesn't trigger new geocoding calls for those same zones (check Google Cloud Console's quota usage, or just confirm the response is fast on the second search).
8. Click "My Profile" and "Discover Artists" in the new nav from both pages — confirm navigation works both directions and the active link is visually highlighted.
9. As a venue, try navigating directly to `/dashboard` or another artist-only URL — confirm you still get redirected to `/venue/profile`, not left on that page (this is the exact bug Task 6 exists to avoid reintroducing in the other direction).
