# Venue Accounts & Login — Design

## Overview

StageReach is currently single-sided: every account is an artist, and venues only exist as private records inside an artist's own pipeline (their notes, contact info, pipeline stage — visible to nobody but that artist). This is the first of three planned pieces that give venues a presence of their own:

1. **Venue accounts & login** (this spec) — venues can sign up, find or create their own profile, and log in.
2. Artist discovery for venues (a venue-side search for artists — future spec).
3. Booking flow (a venue books an artist directly in the app — future spec).

This spec covers only #1. A venue that finishes this flow can log in and manage their own profile — nothing more yet. Searching for artists and booking them are deliberately out of scope here, to be designed once this foundation exists.

---

## Goals

- A real venue owner can sign up, and if any artist already has that venue in their pipeline, find and "claim" it instead of starting from scratch
- A venue that isn't in anyone's pipeline yet can create a brand-new profile, which becomes a real, discoverable listing going forward
- Venue signup is open — no invite code, unlike artist signup — since StageReach's growth plan is artist-first, and no venue should be blocked from joining once artists start inviting them
- Venue profiles capture what a venue actually wants to show off: name, location, venue type, contact info, description, genres of music they book, and stage/equipment details
- Artists' private pipeline data (notes, pipeline stage, confidence level, follow-up dates, who owns the relationship) is never exposed to a venue, never modified by a venue claiming a listing, and never used to auto-populate anything beyond the venue's own public-facing basics (name, city, address, venue type)
- Venues get their own front door — a dedicated landing/signup experience at `/venues` with venue-focused messaging — separate from the artist-facing homepage and signup flow, which are untouched
- Logging in uses one shared mechanism for both artists and venues; after authentication, the app determines which kind of account it is and routes accordingly

## Non-Goals

- No artist discovery / search for venues (next spec)
- No booking flow (next spec after that)
- No pricing or monetization decision for venues (subscription, ads, or otherwise) — nothing in this spec depends on that decision, and it can be layered on top later without touching this design
- No ownership verification beyond "first to claim wins, blocked from claiming twice" — no business license checks, no email/phone matching against pipeline records, no manual approval queue
- No account recovery flow if a venue loses access to a claimed profile — for now, that's a manual/support conversation, not a built feature
- No support for one venue business having multiple locations/rooms — one account, one location, same as artist accounts today
- No change to how artists' existing `venues` pipeline records work, look, or behave — they are read from (for matching) but never written to or altered by this feature

---

## What Changes

### New table: `venue_profiles`

One row per venue account — the venue's own editable identity, entirely separate from any artist's private `venues` pipeline rows.

```
venue_profiles
  id                uuid, primary key
  user_id           uuid, references auth.users, unique — one profile per account
  venue_name        text
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

### Signup flow (no invite code)

New public route `/venues` — a dedicated landing page for venue owners (see "Front door" below), leading into `/venues/signup`:

1. **Create account** — email + password via Supabase auth (same mechanism as artist signup, just no invite-code check).
2. **Search for an existing match** — the venue searches by name + city. This checks across *every* artist's private `venues` pipeline rows (not just one artist's), but only surfaces name, city, address, and venue type — never contact info, notes, pipeline stage, confidence, or which artist owns the relationship. This requires a service-role-backed search (RLS on `venues` normally scopes to the owning artist, so a venue account has no direct read access to other artists' pipeline data).
   - The same search also checks existing `venue_profiles`, so an already-claimed or already-created venue shows up as **taken**, not as a claimable match.
3. **Claim or create:**
   - **Match found (unclaimed)** → selecting it creates a new `venue_profiles` row, pre-filled with that entry's name/city/address/venue type. The original artist's pipeline row is untouched — nothing is linked, deleted, or modified on their side.
   - **Already claimed** → blocked with a simple message ("This venue already has an account — reach out if that's a mistake"). No recovery flow.
   - **No match** → the venue fills out a blank profile from scratch. Once saved, it's a real `venue_profiles` row like any other.
4. **Fill in the rest** — venue type, description, genres, stage/equipment, contact info, photo (whichever weren't already pre-filled).

### Front door: `/venues`

A new, separate landing page with venue-focused messaging, distinct from the artist-facing homepage:

> **STAGEREACH FOR VENUES**
> Book great local artists, without the runaround.
> Browse artist profiles, see their music and pricing, and book directly.
> [Set Up My Venue]

This is purely a marketing/entry surface — it links into the `/venues/signup` flow above. The existing artist-facing homepage, `/signup`, and `/login` pages are untouched.

### Logging in

Venues log in through the same `/login` page and Supabase auth session artists already use — no separate login form. After authentication, routing needs to determine which kind of account this is:

- Has an `artist_profiles` row → existing artist behavior, completely unchanged (including the existing onboarding-incomplete redirect)
- Has a `venue_profiles` row → routed to the venue's own area (their profile page)
- Has neither (mid-signup, e.g. created an auth account but hasn't finished claiming/creating a profile yet) → routed back into whichever signup flow matches how they started (this spec doesn't need to disambiguate further, since venue signup and artist signup are entered from different starting points and don't cross paths)

A single account is assumed to be either an artist or a venue, never both — they're separate signup entry points with separate emails. This isn't enforced with a hard constraint beyond the natural fact that each signup flow only ever creates its own kind of profile row.

### What a venue can do once logged in (v1 scope)

Just view and edit their own `venue_profiles` row. That's the entire venue-facing app surface until the discovery and booking specs land on top of this.

---

## Data Flow

1. Venue visits `/venues` → clicks through to `/venues/signup` → creates an auth account (email/password, no invite code).
2. Client searches `name` + `city` against a new endpoint that service-role-queries both `venues` (all artists, public-safe fields only) and `venue_profiles` (to catch already-claimed venues).
3. Venue picks a match to claim, or starts fresh — either way, a `venue_profiles` row is created for their `user_id`.
4. Venue fills in remaining profile fields and saves — standard RLS-scoped read/write from here on, same pattern as `artist_profiles`.
5. On any subsequent login, the app checks for an `artist_profiles` or `venue_profiles` row tied to the authenticated user and routes accordingly.

---

## Files Touched (indicative — exact structure to be finalized in the implementation plan)

| Area | Change |
|---|---|
| `supabase/migrations/` | New migration: `venue_profiles` table + RLS policies |
| `types/index.ts` | New `VenueProfile` type |
| `app/venues/page.tsx` | New — public "front door" landing page |
| `app/venues/signup/page.tsx` | New — venue signup wizard (account creation → search/claim/create → profile details), client component, mirrors the step-based pattern used by `app/onboarding/page.tsx` |
| `app/api/venues/search-existing/route.ts` | New — service-role search across all artists' `venues` rows + `venue_profiles`, returns public-safe fields only |
| `app/api/venue-profile/route.ts` | New — create (claim/fresh) + GET/PATCH for the logged-in venue's own profile |
| `app/venue/profile/page.tsx` (or similar) | New — the venue's protected profile-management page (v1's entire venue-facing app surface) |
| `proxy.ts` | Extend routing/gating logic to check `venue_profiles` alongside `artist_profiles`; add `/venues` and `/venues/signup` to public routes |
| `CLAUDE.md` | Document the new venue account flow and `venue_profiles` table once built |
