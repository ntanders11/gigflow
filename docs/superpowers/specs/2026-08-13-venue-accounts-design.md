# Venue Accounts & Login — Design

## Overview

StageReach is currently single-sided: every account is an artist, and venues only exist as private records inside an artist's own pipeline (their notes, contact info, pipeline stage — visible to nobody but that artist). This is the first of three planned pieces that give venues a presence of their own:

1. **Venue accounts & login** (this spec) — venues can sign up, find or create their own profile, log in, and get recognized wherever they already appear in artists' pipelines or search results.
2. Artist discovery for venues (a venue-side search for artists — future spec).
3. Booking flow (a venue books an artist directly in the app — future spec).

This spec covers only #1. A venue that finishes this flow can log in and manage their own profile, and their real account becomes visible to artists wherever that venue already shows up in the app. Venues searching for artists and booking them are deliberately out of scope here, to be designed once this foundation exists.

---

## Goals

- A real venue owner can sign up, and if any artist already has that venue in their pipeline, find and "claim" it instead of starting from scratch
- A venue that isn't in anyone's pipeline yet can create a brand-new profile, which becomes a real, discoverable listing going forward
- Venue signup is open — no invite code, unlike artist signup — since StageReach's growth plan is artist-first, and no venue should be blocked from joining once artists start inviting them
- Venue profiles capture what a venue actually wants to show off: name, location, venue type, contact info, description, genres of music they book, and stage/equipment details
- Artists' private pipeline data (notes, pipeline stage, confidence level, follow-up dates, who owns the relationship) is never exposed to a venue, never modified by a venue claiming a listing, and never used to auto-populate anything beyond the venue's own public-facing basics (name, city, address, venue type)
- Venues get their own front door — a dedicated landing/signup experience at `/venues` with venue-focused messaging — separate from the artist-facing homepage and signup flow, which are untouched
- Logging in uses one shared mechanism for both artists and venues; after authentication, the app determines which kind of account it is and routes accordingly
- **Wherever a venue already exists in an artist's world, a real StageReach account gets surfaced and recognized:**
  - Any artist pipeline entry that matches a real venue account shows a small "✓ On StageReach" badge
  - In the existing Discover Venues search, results that match a real venue account are badged the same way **and always ranked above every non-StageReach result**, regardless of the existing HIGH/MEDIUM/LOW confidence ordering

## Non-Goals

- No artist discovery / search for venues (next spec)
- No booking flow (next spec after that)
- No pricing or monetization decision for venues (subscription, ads, or otherwise) — nothing in this spec depends on that decision, and it can be layered on top later without touching this design
- No ownership verification beyond "first to claim wins, blocked from claiming twice" — no business license checks, no email/phone matching against pipeline records, no manual approval queue
- No account recovery flow if a venue loses access to a claimed profile — for now, that's a manual/support conversation, not a built feature
- No support for one venue business having multiple locations/rooms — one account, one location, same as artist accounts today
- No change to how artists' existing `venues` pipeline records work, look, or behave beyond the new badge — pipeline data itself (notes, stage, confidence, contact info) is never read into, written from, or altered by a venue's account
- **Linking scope is bounded, not exhaustive:** a venue's real account gets automatically linked to (a) every existing pipeline row it matches at the moment the account is created, and (b) any Discover Venues result an artist adds to their pipeline after that (since the match is already known at that moment). Venues added later via **CSV import or manual entry are not automatically checked against real accounts** in this pass — that's a reasonable follow-up, not something this spec solves.

---

## What Changes

### New table: `venue_profiles`

One row per venue account — the venue's own editable identity, entirely separate from any artist's private `venues` pipeline rows.

```
venue_profiles
  id                uuid, primary key
  user_id           uuid, references auth.users, unique — one profile per account
  venue_name        text, nullable       -- null while signup is still in progress (see Signup flow)
  address           text, nullable
  city              text, nullable
  venue_type        text, nullable       -- same vocabulary as venues.type today (bar, brewery, winery, etc.)
  contact_email     text, nullable
  contact_phone     text, nullable
  description       text, nullable
  genres            text[], default '{}' -- e.g. ["rock", "jazz", "acoustic"]
  stage_equipment   text, nullable       -- free text: PA, stage size, backline, etc.
  photo_url         text, nullable
  created_at        timestamptz
  updated_at        timestamptz
```

RLS: a venue can only read/write the row where `auth.uid() = user_id` — same pattern as `artist_profiles`.

A unique index on `(lower(venue_name), lower(city))`, applied once `venue_name` is set, prevents two accounts from ever completing signup as the same venue — if two people try to claim/create the same venue at the same moment, the database rejects the second write and that request is shown the same "this venue already has an account" message as a normal already-claimed match.

### New column: `venues.venue_profile_id`

A nullable foreign key added to the existing `venues` table (an artist's private pipeline rows), pointing at `venue_profiles.id`. This is the link that powers the "✓ On StageReach" badge — everything else about the `venues` row (notes, stage, confidence, contact info) is completely unaffected by whether this is set.

### Signup flow (no invite code)

New public route `/venues` — a dedicated landing page for venue owners (see "Front door" below), leading into `/venues/signup`:

1. **Create account** — email + password via Supabase auth, same mechanism and email-confirmation behavior as artist signup (no new decision here — just reused as-is). This immediately creates a `venue_profiles` row with `venue_name` left blank — this placeholder row is what lets the app tell "a venue mid-signup" apart from "an artist mid-signup" at every step from here on (see Logging in, below).
2. **Search for an existing match** — the venue searches by name + city. This checks across *every* artist's private `venues` pipeline rows (not just one artist's), but only surfaces name, city, address, and venue type — never contact info, notes, pipeline stage, confidence, or which artist owns the relationship. This requires a service-role-backed search (RLS on `venues` normally scopes to the owning artist, so a venue account has no direct read access to other artists' pipeline data). Results are de-duplicated by normalized name + city first — if five different artists each have their own copy of "The Blue Note," the venue sees one match candidate, not five, pre-filled from whichever of those five entries has the most complete data.
   - The same search also checks existing `venue_profiles` (by the same unique-index key), so an already-claimed or already-created venue shows up as **taken**, not as a claimable match.
3. **Claim or create:**
   - **Match found (unclaimed)** → selecting it fills in the placeholder `venue_profiles` row with that entry's name/city/address/venue type, and triggers the linking sweep below.
   - **Already claimed** → blocked with a simple message ("This venue already has an account — reach out if that's a mistake"). No recovery flow.
   - **No match** → the venue fills out the placeholder profile from scratch. Once `venue_name` is saved, the same linking sweep runs (in case a matching pipeline row existed but didn't surface as an exact match earlier).
4. **Linking sweep** — the moment `venue_name` is set (claim or fresh), the app finds every artist's `venues` row matching that name + city (the same matching logic used for search) and sets `venue_profile_id` on all of them — not just the one row the venue interacted with. This is what makes the badge (below) show up correctly for every artist who already had this venue in their pipeline, not just the one whose entry happened to surface during search.
5. **Fill in the rest** — venue type, description, genres, stage/equipment, contact info, photo (whichever weren't already pre-filled).

The original artist pipeline rows are never deleted or overwritten by any of this — only the new `venue_profile_id` link is set on matching rows, and only after venue_name is confirmed real.

### Front door: `/venues`

A new, separate landing page with venue-focused messaging, distinct from the artist-facing homepage. Copy is scoped to what this spec actually builds — it doesn't promise discovery or booking, which don't exist yet:

> **STAGEREACH FOR VENUES**
> Get discovered by artists in your area.
> Set up your venue's profile — genres you book, your stage setup, how to reach you — so artists already using StageReach can find you.
> [Set Up My Venue]

This is purely a marketing/entry surface — it links into the `/venues/signup` flow above. The existing artist-facing homepage, `/signup`, and `/login` pages are untouched.

### Logging in

Venues log in through the same `/login` page and Supabase auth session artists already use — no separate login form. After authentication, routing needs to determine which kind of account this is. The existing middleware currently redirects *any* authenticated user lacking a complete `artist_profiles` row to `/onboarding` — that check needs to run only when there's no `venue_profiles` row at all, otherwise a venue would be incorrectly swept into the artist onboarding wizard:

- Has a `venue_profiles` row → this is a venue account, full stop (an artist account never gets one). If `venue_name` is still blank, signup didn't finish — redirect to `/venues/signup` to continue. If it's set, route to the venue's own protected area.
- No `venue_profiles` row, has an `artist_profiles` row → existing artist behavior, completely unchanged (including the existing onboarding-incomplete redirect).
- Neither exists → not a reachable state under this design, since account creation (step 1 of either signup flow) always creates one or the other immediately.

A single account is assumed to be either an artist or a venue, never both — they're separate signup entry points with separate emails, and the `venue_profiles` row created at step 1 makes that unambiguous everywhere else in the app.

### What a venue can do once logged in (v1 scope)

Just view and edit their own `venue_profiles` row. That's the entire venue-facing app surface until the discovery and booking specs land on top of this.

### Pipeline badge

On the artist's pipeline board, any venue card where `venues.venue_profile_id` is set shows a small "✓ On StageReach" badge, alongside the existing stage/confidence indicators. This is read-only from the artist's side — it's just a signal that this venue has a real account, not something the artist can set or remove.

### Discover Venues ranking boost

The existing Discover Venues search (`GET /api/venues/discover`) already merges results from Google Places, Geoapify, and OpenStreetMap. This spec adds one more step: after merging, each result is checked against `venue_profiles` by the same name + city matching logic used elsewhere in this spec. Any match:
- Gets the same "✓ On StageReach" badge
- Is sorted **above every non-matching result**, regardless of the existing HIGH/MEDIUM/LOW confidence ordering — verified StageReach accounts always come first

If an artist adds one of these badged results to their pipeline, the new `venues` row is created with `venue_profile_id` already set (the match is already known at that point — no extra sweep needed).

---

## Data Flow

1. Venue visits `/venues` → clicks through to `/venues/signup` → creates an auth account (email/password, no invite code). A blank `venue_profiles` row is created immediately.
2. Client searches `name` + `city` against a new endpoint that service-role-queries both `venues` (all artists, de-duplicated, public-safe fields only) and `venue_profiles` (to catch already-claimed venues).
3. Venue picks a match to claim, or starts fresh — either way, the placeholder `venue_profiles` row is filled in with `venue_name` set.
4. The moment `venue_name` is set, a linking sweep sets `venue_profile_id` on every matching artist's `venues` row.
5. Venue fills in remaining profile fields and saves — standard RLS-scoped read/write from here on, same pattern as `artist_profiles`.
6. On any subsequent login, the app checks for a `venue_profiles` row first, then falls back to existing `artist_profiles` logic, and routes accordingly.
7. Separately, any time an artist views their pipeline or runs a Discover Venues search, venues with a set/matching `venue_profile_id` show the "✓ On StageReach" badge — and in Discover Venues, are always sorted to the top.

---

## Files Touched (indicative — exact structure to be finalized in the implementation plan)

| Area | Change |
|---|---|
| `supabase/migrations/` | New migration: `venue_profiles` table + unique index + RLS policies; new `venue_profile_id` column + FK on `venues` |
| `types/index.ts` | New `VenueProfile` type; add `venue_profile_id` to `Venue` |
| `app/venues/page.tsx` | New — public "front door" landing page |
| `app/venues/signup/page.tsx` | New — venue signup wizard (account creation → search/claim/create → profile details), client component, mirrors the step-based pattern used by `app/onboarding/page.tsx` |
| `app/api/venues/search-existing/route.ts` | New — service-role search across all artists' `venues` rows (de-duplicated) + `venue_profiles`, returns public-safe fields only |
| `app/api/venue-profile/route.ts` | New — create (claim/fresh) + GET/PATCH for the logged-in venue's own profile; triggers the linking sweep when `venue_name` is set |
| `app/venue/profile/page.tsx` (or similar) | New — the venue's protected profile-management page (v1's entire venue-facing app surface) |
| `proxy.ts` | Check `venue_profiles` before the existing `artist_profiles`/onboarding check; add `/venues` and `/venues/signup` to public routes |
| `components/pipeline/KanbanBoard.tsx` | Add "✓ On StageReach" badge when `venue_profile_id` is set |
| `components/venue/VenueDetail.tsx` | Same badge, for consistency on the venue detail page |
| `app/api/venues/discover/route.ts` | Cross-reference merged results against `venue_profiles`; badge and always-rank-first matches |
| `components/discover/DiscoverView.tsx` | Render the badge on matched results; when adding to pipeline, set `venue_profile_id` on the created row |
| `CLAUDE.md` | Document the new venue account flow, `venue_profiles` table, and the badge/ranking behavior once built |
