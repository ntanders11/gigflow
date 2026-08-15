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
- **No changes to the existing artist-side Discover Venues feature or the artist's own public profile page** — both are read from, never modified.

---

## What Changes

### New page: `/venue/discover`

A client component, structurally similar to the existing `components/discover/DiscoverView.tsx` (artist-side): a location + radius search control at the top, results below.

- **Auto-search on load**, using the venue's own `city` (from their `venue_profiles` row) as the default search location — mirrors how the artist-side Discover Venues auto-searches using the artist's home zone.
- Location input + radius slider (2–50 mi, matching the existing control) let the venue adjust and re-search manually.
- Results render as two sections when the venue has at least one genre set:
  - **"Matches your genres (…)"** — artists whose own `genres` array shares at least one entry with the venue's `genres`
  - **"Other artists nearby"** — every other artist within the searched radius
- If the venue's `genres` is empty, both sections collapse into one: **"Artists in your area"**.
- Each result card shows: photo (or initial avatar, matching the existing pattern), artist name, and genre tags. No distance figure is shown, even though results are filtered to the searched radius.
- Clicking a card links to `/profile/[id]` (existing page, unmodified) in the same tab.
- Empty state (no artists found in the searched area) shows a plain message, same tone as Discover Venues' empty state today.

### New endpoint: `GET /api/venues/discover-artists`

Mirrors the shape of the existing `GET /api/venues/discover`, but the reverse direction — searches StageReach's own `artist_profiles` + `zones` tables instead of external APIs.

1. Requires an authenticated venue session (checks for a `venue_profiles` row, same pattern as the venue-only checks elsewhere — though note per the venue-accounts spec, this is a "should only be called by venues" convention enforced by what the UI does, not a hard server-side role gate; consistent with how `search-existing` already works).
2. Geocodes the requested city (reusing the existing `geocodeCity` helper from `app/api/venues/discover/route.ts` — Google Geocoding first, Geoapify/Nominatim fallback).
3. Reads every artist's `zones` row (`zip_code`, `radius_mi`) and geocodes each zip code to get a lat/lon (on-the-fly, no caching — acceptable given StageReach's current scale; worth revisiting if the artist count grows large enough to make repeated geocoding calls costly).
4. Keeps artists whose zone falls within the searched radius.
5. Joins in each matching artist's `artist_profiles` row (`display_name`, `genres`, `photo_url`, `user_id` — used to build the `/profile/[id]` link). Only artists with a non-empty `display_name` (i.e., who've actually completed onboarding) are eligible — matches the existing rule that an incomplete artist profile isn't real yet.
6. Splits results into the two tiers described above, based on the requesting venue's own `genres`.

### New venue navigation header

A simple header component (new, not reusing the artist `Sidebar`) rendered on both `/venue/profile` and `/venue/discover`, with two links: "My Profile" and "Discover Artists". Minimal — no logo redesign, no additional nav items, matching the existing venue pages' plain dark/gold visual language.

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
| `app/venue/discover/page.tsx` | New — the venue-side artist search page |
| `app/api/venues/discover-artists/route.ts` | New — searches `artist_profiles` + `zones` by location, tiers by genre match against the requesting venue's own genres |
| `components/venue/VenueNav.tsx` (or similar) | New — simple two-link header ("My Profile" / "Discover Artists"), added to both venue pages |
| `app/venue/profile/page.tsx` | Modified — renders the new nav header |
| `app/api/venues/discover/route.ts` | Read from only — `geocodeCity` (or an extracted shared version of it) is reused, not duplicated |
