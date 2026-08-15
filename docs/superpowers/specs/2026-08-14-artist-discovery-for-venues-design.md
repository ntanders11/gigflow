# Artist Discovery for Venues — Design

## Overview

This is the second of three planned pieces giving venues a real presence in StageReach. Venue accounts & login (the first piece) shipped and was verified live — venues can sign up, claim or create a profile, and are visible to artists via a "⭐ On StageReach" badge. Right now, though, `/venue/profile` is the *entire* venue-facing app surface — a venue can manage their own listing but has no way to actually find and reach out to artists.

This spec adds that: a search page where a logged-in venue can browse real StageReach artists near them, prioritized by whether the artist's genres match what the venue books. Booking/scheduling remains explicitly out of scope — noted as a future idea, not built here (see Non-Goals).

---

## Goals

- A logged-in venue can search for artists by location, using the exact same city + radius pattern the existing artist-side Discover Venues search already uses (same geocoding, same UX shape)
- The search auto-runs on page load using the venue's own city, so a venue sees results immediately without having to type anything first — same pattern Discover Venues already uses for artists searching by their home zone
- Results are split into two tiers based on the venue's own "genres you book" (collected during venue signup): artists sharing at least one genre appear first, every other artist in the searched area appears below — never hidden, just ranked lower
- If a venue never filled in "genres you book" (it's optional), there's nothing to tier against — they see one flat "Artists in your area" list instead
- Each result links directly to that artist's existing public profile page (`/profile/[id]`), which already has everything a venue needs to evaluate and reach out to them: bio, music/video samples, rates, and a "Send Booking Inquiry" button that opens an email — no new profile-detail view is built for this
- Venues get their first real navigation — a simple header with "My Profile" and "Discover Artists" — since this is the first page beyond their own profile they can reach

## Non-Goals

- **No booking/scheduling mechanism.** A venue finding an artist here reaches out the same way anyone does today — by email, via the existing "Send Booking Inquiry" button on the artist's profile. Actually booking an artist (writing to their calendar, requiring their confirmation before it's treated as real) is a meaningfully larger, separate piece — noted as a future idea, not built now.
- **No new artist-detail page.** The existing public `/profile/[id]` page is reused as-is, unmodified.
- **No in-app messaging.** Consistent with the rest of this portal — email is the contact mechanism, not a chat/inbox feature.
- **No saved/favorites list** for venues to bookmark artists they're interested in.
- **No manual genre filter/search box.** The two-tier automatic ranking (matches the venue's stated genres vs. everyone else) is the only genre-based mechanism in this piece — a venue doesn't separately type in a genre to filter by.
- **No behavior changes to the existing artist-side Discover Venues feature or the artist's own public profile page** — both are read from, not modified in what they do. The one exception is purely mechanical: `app/api/venues/discover/route.ts` gets its `geocodeCity` function extracted into a shared module so this new endpoint can reuse it too (see "What Changes" and Files Touched) — the route's own behavior is unchanged, only where that one function is defined moves.

---

## What Changes

### New page: `/venue/discover`

A client component, structurally similar to the existing `components/discover/DiscoverView.tsx` (artist-side): a location + radius search control at the top, results below.

- **Auto-search on load**, using the venue's own `city` (from their `venue_profiles` row) as the default search location — mirrors how the artist-side Discover Venues auto-searches using the artist's home zone.
- Location input + radius slider (2–50 mi, matching the existing control) let the venue adjust and re-search manually.
- Results render as two sections when the venue has at least one genre set:
  - **"Matches your genres (…)"** — artists whose own `genres` array shares at least one entry with the venue's `genres`, compared case-insensitively with whitespace trimmed on both sides (genres are free-text tags typed by users on both the artist and venue side — no fixed list — so "Rock" and "rock" must still count as a match)
  - **"Other artists nearby"** — every other artist within the searched radius
- If the venue's `genres` is empty, both sections collapse into one: **"Artists in your area"**.
- Each result card shows: photo (or initial avatar, matching the existing pattern), artist name, and genre tags. No distance figure is shown, even though results are filtered to the searched radius.
- Clicking a card links to `/profile/[id]` (existing page, unmodified) in the same tab.
- Empty state (no artists found in the searched area) shows a plain message, same tone as Discover Venues' empty state today.

### New endpoint: `GET /api/venues/discover-artists`

Mirrors the shape of the existing `GET /api/venues/discover`, but the reverse direction — searches StageReach's own `artist_profiles` + `zones` tables instead of external APIs.

1. Requires an authenticated venue session (checks for a `venue_profiles` row, same pattern as the venue-only checks elsewhere — though note per the venue-accounts spec, this is a "should only be called by venues" convention enforced by what the UI does, not a hard server-side role gate; consistent with how `search-existing` already works).
2. Geocodes the requested city, reusing the same geocoding logic the existing Discover Venues route already has. That logic (`geocodeCity`) currently lives as a private, unexported function inside `app/api/venues/discover/route.ts` — this spec requires extracting it into a shared module (`lib/geocoding.ts`) that both routes import, rather than duplicating it.
3. Reads every artist's `zones` row (`user_id`, `name`, `radius_mi`, plus the new `lat`/`lon` columns below). `zones` RLS scopes reads to the owning artist (`auth.uid() = user_id`), so — like the venue-accounts search endpoint before it — this cross-user read requires the service-role client, not the venue's own RLS-scoped session.
4. **Zone coordinates are cached, not geocoded fresh on every search.** `zones` gets two new nullable columns, `lat` and `lon`, populated once when a zone is geocoded for the first time (lazily: the first search that encounters a zone with no cached coordinates geocodes it and saves the result back to that row via the service-role client; every subsequent search reads the cached value instead of re-geocoding). The geocoding input is the zone's `name` (e.g. "Newberg, OR") — the same field the artist-side Discover Venues search already geocodes for its own auto-search — not `zip_code`, which is optional and can be blank; `name` is a required field set during onboarding, so every zone has something geocodable. Without this caching, a single venue search would geocode the venue's own city *plus every distinct artist zone*, every time — with Google Geocoding capped at 200 calls/day project-wide (per CLAUDE.md), that's a multiplicative cost (searches × artists), not additive, and could exhaust the daily cap after only a handful of searches even with a small number of artists. Caching drops repeat cost to zero for any zone that's already been geocoded once.
5. Keeps artists whose cached zone coordinates fall within the searched radius.
6. Joins in each matching artist's `artist_profiles` row (`display_name`, `genres`, `photo_url`, `user_id` — used to build the `/profile/[id]` link). `artist_profiles` already has a public-read RLS policy (the same one that lets anyone view `/profile/[id]` without logging in), so this join can go through the venue's own RLS-respecting session — only the `zones` read in step 3 needs the service-role client. Only artists with a non-empty `display_name` (i.e., who've actually completed onboarding) are eligible — matches the existing rule that an incomplete artist profile isn't real yet.
7. Splits results into the two tiers described above, based on the requesting venue's own `genres`, using the same case-insensitive/trimmed comparison.

### New venue navigation header

A simple header component (new, not reusing the artist `Sidebar`) rendered on both `/venue/profile` and `/venue/discover`, with two links: "My Profile" and "Discover Artists". Minimal — no logo redesign, no additional nav items, matching the existing venue pages' plain dark/gold visual language.

### Middleware update (required — not optional)

`proxy.ts` currently redirects a fully-provisioned venue account to `/venue/profile` from *any* path that isn't exactly `/venue/profile` (added when fixing the "venue lands on the artist dashboard" bug during the first piece). As written, that would also redirect `/venue/discover` back to `/venue/profile` — the new page would be unreachable. The condition needs to widen from an exact match on `/venue/profile` to a prefix match on `/venue/` (i.e., any path under the venue namespace is allowed through), so this and any future venue-facing page work without needing another middleware change each time.

---

## Data Flow

1. Venue logs in, lands on `/venue/discover` (or navigates there from the new header).
2. Page loads, auto-fills the location input with the venue's own `city`, and calls `GET /api/venues/discover-artists?city=<venue's city>&radius=30`.
3. The endpoint geocodes the city, finds artists whose zones fall within the radius, splits them into the two genre tiers, and returns both lists.
4. The venue can adjust the location/radius and re-search manually, same as Discover Venues today.
5. Clicking any result navigates to that artist's existing `/profile/[id]` page — from there, "Send Booking Inquiry" opens the venue's email client, exactly as it already does for anyone visiting that page.

---

## Files Touched (indicative — exact structure to be finalized in the implementation plan)

| Area | Change |
|---|---|
| `supabase/migrations/017_zones_lat_lon.sql` (or next available number) | New — adds nullable `lat`, `lon` columns to `zones`, populated lazily on first use |
| `lib/geocoding.ts` | New — `geocodeCity` extracted here from `app/api/venues/discover/route.ts` so both routes can import it |
| `app/api/venues/discover/route.ts` | Modified — imports `geocodeCity` from the new shared module instead of defining it locally; otherwise unchanged |
| `app/venue/discover/page.tsx` | New — the venue-side artist search page |
| `app/api/venues/discover-artists/route.ts` | New — searches `artist_profiles` (via the venue's own RLS session) + `zones` (via service-role) by location, caches zone coordinates on first geocode, tiers results by genre match against the requesting venue's own genres |
| `components/venue/VenueNav.tsx` (or similar) | New — simple two-link header ("My Profile" / "Discover Artists"), added to both venue pages |
| `app/venue/profile/page.tsx` | Modified — renders the new nav header |
| `proxy.ts` | Modified — widen the venue-account redirect from an exact match on `/venue/profile` to a prefix match on `/venue/`, so `/venue/discover` (and future venue pages) are reachable |
