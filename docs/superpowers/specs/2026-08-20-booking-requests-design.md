# Booking Requests — Design

## Overview

This is the fourth piece of StageReach's venue-facing portal, and the last one still queued: a way for a venue to actually lock in a gig date with an artist through the app, instead of the process stopping at "email them and hope." Booking/scheduling was explicitly deferred during the artist-discovery-for-venues design ("noted as a future idea, not built now") and during mutual ratings' brainstorm — Taylor is requesting it now that venue accounts, artist discovery, and mutual ratings are all shipped and live.

A venue picks a date on an artist's public profile and sends a request. The artist reviews it on their existing Booking Calendar and accepts or declines. Accepting turns it into a normal Gig — the exact same kind of gig an artist already manages today, with the same prep checklist, the same completion flow, and (once completed) the same mutual-ratings eligibility. Nothing downstream of "gig exists" needs to change; this feature's whole job is producing that gig through a real two-sided handshake instead of only ever being artist-entered.

---

## Goals

- A venue can send a booking request to any artist on StageReach from that artist's public profile page (`/profile/[id]`) — not limited to artists found via Discover Artists
- The request includes a date, start/end time, and an optional note
- The date picker on that request form greys out dates the artist already has a confirmed StageReach gig on, so a venue doesn't waste a request on an unavailable date
- The artist must explicitly accept or decline — a venue's request is never automatically "booked"
- Accepting creates a real `Gig` (and a linked pipeline entry, if one doesn't already exist for that venue) — the artist's Booking Calendar becomes the single source of truth for confirmed dates, exactly as it is today
- Declining notifies the venue so they're not left wondering
- Venues can see the status of every request they've sent, in one place
- The existing "Send Booking Inquiry" mailto link on the artist public profile is replaced by this flow

## Non-Goals

- **No counter-proposing a different date.** Accept or decline only. If a date doesn't work, the venue sends a new request.
- **No withdrawing a sent request, and no canceling an accepted booking through this flow.** Canceling a confirmed gig still works exactly as it does today, through the existing Booking Calendar.
- **No blocking on pending requests.** Only an artist's actually-confirmed gigs grey out the date picker — a pending request from a different venue doesn't reserve anything. If two venues request the same date, the artist just declines whichever one they don't take when they get to it.
- **No in-app messaging/chat.** The note field is one-way, venue → artist, at request time only — consistent with the rest of this portal avoiding a messaging system.
- **No changes to the existing Gig model, prep checklist, completion flow, or mutual-ratings eligibility.** An accepted booking request produces an ordinary `Gig` row; everything downstream already works and stays untouched.

---

## What Changes

### Data model

**New table: `booking_requests`** — one row per request, tracking its own lifecycle independent of the artist's Gig calendar until accepted:

```sql
create table public.booking_requests (
  id                uuid primary key default gen_random_uuid(),
  venue_profile_id  uuid not null references public.venue_profiles(id) on delete cascade,
  artist_user_id    uuid not null references public.profiles(id) on delete cascade,

  date              date not null,
  start_time        text,   -- HH:MM, matches gigs.start_time's format
  end_time          text,   -- HH:MM
  message           text,

  status            text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  gig_id            uuid references public.gigs(id) on delete set null,  -- set once accepted

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

**Access pattern:** like `venue_artist_ratings`, this table gets RLS enabled with **no client-facing policies** — every read/write goes through a server route using the service-role client. Unlike ratings, there's no "hide one half of a row" problem here, but the same reasoning still applies for a different reason: a venue must only ever be able to write the fields that make sense for *creating* a request (date, time, message), and an artist must only ever be able to write `status` when *responding* to one — Postgres RLS restricts which *rows* a policy allows, not which *columns* within an allowed row, so a raw RLS policy letting an artist "update their own requests" couldn't stop them from also rewriting the venue's original date or message. Enforcing "artist's response endpoint can only ever change `status`" in application code (the same approach already used for the ratings feature) is simpler and more robust than trying to express column-level restrictions through RLS.

### New API routes (venue side)

- `POST /api/venue/booking-requests` — creates a request. Requires a completed venue account (`venue_profiles.venue_name` set). Body: `{ artist_user_id, date, start_time, end_time, message }`. Sends the artist a "You have a new booking request" email.
- `GET /api/venue/booking-requests` — every request this venue has sent, with current status, ordered newest first.

### New API routes (artist side)

- `GET /api/booking-requests` — every pending request addressed to this artist (mirrors the ratings "pending" list pattern) — powers the new Booking Calendar section.
- `PATCH /api/booking-requests/[id]` — accept or decline. Body: `{ status: "accepted" | "declined" }`. Only the artist the request is addressed to may call this. The route must also check the request is still `status: "pending"` before acting — re-accepting or re-declining an already-resolved request should be rejected (e.g. 409), not silently re-run.
  - **On accept:** finds or creates a pipeline `venues` row for this venue under this artist (see "Accepting a request," below), creates a real `Gig` on it with `status: "upcoming"` — copying `date`, `start_time`, `end_time` directly onto the matching Gig columns, and `message` onto `Gig.notes` — sets `booking_requests.gig_id` to the new gig, sets `status: "accepted"`, and emails the venue that they're confirmed.
  - **On decline:** sets `status: "declined"` and emails the venue.
  - **Conflicting pending requests are left alone, on purpose.** If a second venue's pending request for the same date exists when the first gets accepted, it is NOT auto-declined or flagged — it just sits as `pending` until the artist manually declines it (or, in principle, accepts it too, which this spec doesn't attempt to prevent). This matches the Non-Goals decision that pending requests never blocked anything in the first place; it's a deliberate simplification, not an oversight.

### Public route

- `GET /api/public/artists/[id]/availability` — no login required (same pattern as the public ratings routes). Returns just an array of dates (`["2026-09-12", "2026-09-19", ...]`) from that artist's `gigs` where `status = 'upcoming'` and the date is today or later. No venue names, no other details — just which dates are taken. Powers the date picker's grey-out on the request form.

### Accepting a request: creating the pipeline entry

If the artist doesn't already have a `venues` pipeline row linked to this `venue_profile_id`, one is created automatically — reusing the exact "find or create a default zone for this user" pattern already used by `POST /api/venues` (Discover Venues' "add to pipeline" flow) for the same reason: a venue arriving through a booking request has no "search zone" context the way one found via Discover Venues does. The new pipeline row is filled in from the venue's real account (`venue_name`, `city`, `venue_type`, `address`, `contact_email`, `contact_phone`), linked via `venue_profile_id`, and set to `stage: "booked"` — since by construction, a `Gig` is being created on it in the same operation. If a matching pipeline row already exists (same matching logic as the existing linking sweep, `lib/venues/matching.ts`) but isn't yet linked, it gets linked rather than duplicated — and its `stage` is also set to `"booked"`, same as a freshly-created row, since a confirmed Gig is being placed on it in this same operation regardless of which pipeline stage it was previously sitting at (e.g. `"contacted"` or `"negotiating"`). This does overwrite whatever stage the artist had it at; that's intentional — a real accepted booking is the strongest possible pipeline signal.

### New page section: Booking Requests (artist side)

A new section on the existing Booking Calendar (`app/(protected)/calendar/page.tsx`) showing pending requests — venue name, requested date/time, their note, and **Accept**/**Decline** buttons per request. Same visual pattern as the ratings feature's "Awaiting your rating" list. Once responded to, a request drops out of this list (accepted ones simply become a normal gig, visible the same way any other gig already is).

`components/layout/Sidebar.tsx` already has a live pending-count badge on the "Ratings" nav link (fed by `/api/ratings/pending`) — the same pattern extends to the "Booking Calendar" link here, fed by `GET /api/booking-requests`'s pending count, so a new request is actually noticeable without opening the Calendar page first. This is a deliberate extension of an existing convention, not an afterthought — `Sidebar.tsx` is in Files Touched for exactly this.

### New page: Bookings (venue side)

`/venue/bookings` — every request this venue has sent and its status (pending/accepted/declined), added to `VenueNav` alongside Ratings. Unlike the artist-side Ratings/Calendar badges, this link gets **no pending-count badge** — there's nothing actionable for the venue to do here (they're just checking status, not responding to anything), so a badge would have nothing meaningful to count. This is a deliberate difference from the Ratings-link badge pattern already in `VenueNav.tsx`, not an oversight.

### Artist public profile: replacing "Send Booking Inquiry"

On `/profile/[id]`, the existing `mailto:` link is replaced with a **"Request to Book"** button. What it shows depends on the viewer, and this is where the viewer-identity check needs to actually live: `app/profile/[id]/page.tsx` is currently a fully public server component with no auth check at all (it only ever uses `createServiceClient()`). This page needs to additionally call `auth.getUser()` and, if a user is present, check for a completed `venue_profiles` row (`venue_name` set) for that user — then pass a simple viewer-type value (`"venue" | "other"`) as a prop into the new client button/modal, which renders one of:

- **Logged-in venue with a completed account:** the button opens the request form (date picker with unavailable dates greyed out via the new public availability endpoint, start/end time, optional note).
- **Anyone else** (logged out, or logged in as an artist): a simpler prompt — "Are you a venue? Sign up to request a booking," linking to `/venues/signup`. Nothing is sent from this state; it's just a path in.

This is a strict improvement over the mailto link in one respect worth noting: the old link silently produced a broken `mailto:` if the artist had no `contact_email` set. The new flow doesn't depend on that field at all — notifications go through the same system-email pattern as ratings (`profiles.email` lookup, sent from the shared `RESEND_FROM_EMAIL` sender — currently `booking@stagereach.app` — same as every other platform notification email).

### Notifications

Two emails, both via the same shared Resend sender (`RESEND_FROM_EMAIL`) and `profiles.email` lookup pattern already established for ratings — these are platform notifications, not artist-identity pitches, so they don't go through `sendArtistEmail`.

1. **"You have a new booking request"** — sent to the artist the moment a venue submits a request.
2. **"Your booking request was accepted" / "...was declined"** — sent to the venue the moment the artist responds.

---

## Data Flow

1. A venue visits an artist's public profile, clicks "Request to Book," picks an available date/time, optionally adds a note, and submits.
2. The artist gets an email and sees the request on their Booking Calendar.
3. The artist accepts or declines.
   - **Accept:** the pipeline entry is created/linked if needed, a real Gig is created, the venue is emailed, and from this point on the booking behaves exactly like any other gig the artist manages — same checklist, same completion flow, and once marked completed, the same mutual-ratings eligibility as always.
   - **Decline:** the venue is emailed; nothing else changes.
4. The venue can check the status of any request they've sent on `/venue/bookings` at any time.

---

## Files Touched (indicative — exact structure to be finalized in the implementation plan)

**Migration numbering note:** the local `supabase/migrations/` folder is not a fully reliable source of truth for the live schema — `gigs.checklist` (used in `types/index.ts` and `components/venue/GigsSection.tsx`) has no corresponding migration file anywhere in this repo, meaning at least one schema change was applied directly in Supabase outside of a committed migration. `019` is the next free number by filename, but the implementation plan should confirm against Supabase's actual migration history (not just local files) before finalizing the number.

| Area | Change |
|---|---|
| `supabase/migrations/019_booking_requests.sql` | New — `booking_requests` table, RLS enabled with no client policies |
| `types/index.ts` | New `BookingRequest`, `BookingRequestStatus` types |
| `app/api/venue/booking-requests/route.ts` | New — venue's `GET`/`POST` |
| `app/api/booking-requests/route.ts` | New — artist's pending list (`GET`) |
| `app/api/booking-requests/[id]/route.ts` | New — artist's accept/decline (`PATCH`) |
| `app/api/public/artists/[id]/availability/route.ts` | New — public, dates-only availability for the date picker |
| `lib/email/booking-request-notifications.ts` | New — the two notification emails, same pattern as `lib/email/rating-notifications.ts` |
| `app/(protected)/calendar/page.tsx` | Modified — adds the pending Booking Requests section |
| `components/calendar/BookingRequestsSection.tsx` | New — the pending-requests list + accept/decline UI |
| `components/layout/Sidebar.tsx` | Modified — extends the existing pending-count badge pattern to the Booking Calendar nav link |
| `app/venue/bookings/page.tsx` | New — venue's sent-requests list, no pending-count badge (nothing actionable) |
| `components/venue/VenueNav.tsx` | Modified — adds "Bookings" nav link (no badge, deliberately) |
| `app/profile/[id]/page.tsx` | Modified — replaces the mailto "Send Booking Inquiry" link with the new "Request to Book" control |
| `components/booking/RequestBookingModal.tsx` | New — the client-side request form (date picker, time, note), embedded in the server-rendered profile page |
