# Artist Blackout Dates — Design

## Overview

Artists can mark date ranges as unavailable ("blackout dates") — for private events, time off, or anything else — directly from their Booking Calendar (`/calendar`). A blocked date behaves exactly like an already-booked date to venues: it can't be selected when requesting a booking on the artist's public profile, and this is now enforced server-side, not just hinted at in the UI.

Building this also closes a real gap found while scoping it: `POST /api/venue/booking-requests` currently has no server-side check preventing a request for a date the artist already has a confirmed gig on — only a disabled Submit button (client-side only) stops it today. This spec fixes that at the same time, since blackout dates need the identical enforcement point.

## Data Model

New migration `supabase/migrations/025_artist_blackout_dates.sql`:

```sql
create table public.artist_blackout_dates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint artist_blackout_dates_range_check check (end_date >= start_date)
);

create index idx_artist_blackout_dates_user_id on public.artist_blackout_dates(user_id);

create trigger artist_blackout_dates_updated_at
  before update on public.artist_blackout_dates
  for each row execute function update_updated_at();

alter table public.artist_blackout_dates enable row level security;

create policy "Artists manage their own blackout dates"
  on public.artist_blackout_dates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

Unlike `booking_requests` or `venue_artist_ratings`, this table gets a normal client-facing RLS policy rather than "no policies, service-role only" — every row is owned and written by exactly one party (the artist), with no second party ever writing to it. A venue only ever *reads* another artist's blackout ranges indirectly, through the existing availability endpoint (already using a service-role client). This matches how `gigs` is already handled.

`note` is never sent to any venue-facing endpoint or response — it's for the artist's own reference only.

## Shared Availability Logic

New file `lib/bookings/availability.ts`, extracting logic currently only in the availability route so it can be reused by the new server-side enforcement point:

- `getUnavailableDates(service, artistUserId): Promise<string[]>` — every individual `YYYY-MM-DD` the artist is unavailable on: each upcoming confirmed gig's date, plus every day inside each blackout range expanded individually. Used by `GET /api/public/artists/[id]/availability` (replacing that route's current inline gigs-only query) — the response shape (`{ dates: string[] }`) is unchanged, so `RequestBookingModal.tsx` needs no changes.
- `isDateUnavailable(service, artistUserId, date): Promise<boolean>` — a single-date check via two targeted queries (an upcoming gig on that exact date; a blackout row where `start_date <= date <= end_date`), used by the new server-side enforcement in `POST /api/venue/booking-requests`. Deliberately not implemented by calling `getUnavailableDates` and checking membership — that would mean generating a full list just to check one date.

Both helpers live in one file so the two call sites (the read-only hint endpoint, and the real enforcement point) can never quietly drift apart on what "unavailable" means.

## Server-Side Enforcement (the actual fix)

`POST /api/venue/booking-requests` gets one new check, right after the existing artist-lookup validation and before the insert: call `isDateUnavailable(service, artist_user_id, date)`; if true, return `400 { error: "This artist isn't available on that date." }` and don't create the row. This is the change that actually stops a determined venue from bypassing the greyed-out date picker — today nothing does.

## UI: Managing Blackout Dates

On `/calendar`, next to the existing page header: a "Block Dates" button opens a small form (start date, end date, optional note) — modeled on the existing "+ Add Gig Date" form pattern in `components/venue/GigsSection.tsx` for visual consistency. On submit, `POST /api/blackout-dates`.

If the new range overlaps a `pending` or `accepted` booking request the artist already has (checked server-side in that POST handler), the response includes a non-blocking `warning` field (e.g. `"You already have a booking on Sep 12 — this won't cancel it, but nothing new can be booked in this range."`); the UI shows this as a dismissible note after the range is saved, but the range is created either way. Blocking never touches or cancels any existing gig or booking request — it only ever prevents *new* requests going forward.

Below the calendar grid, alongside the existing "All Booked Gigs" list, a new "Blocked Dates" list shows each range (date span + note if any) with a "Remove" button, calling `DELETE /api/blackout-dates/[id]`.

On the month grid itself (`components/calendar/CalendarView.tsx`), a day that falls inside any blackout range gets a visual marker distinct from a booked-gig day — a muted diagonal-hatch or greyed background, so blocked and booked read as clearly different states at a glance.

## New API Routes

- `GET /api/blackout-dates` — the logged-in artist's own ranges (RLS-scoped `createClient()`, no service-role needed — this is the artist reading their own rows).
- `POST /api/blackout-dates` — body `{ start_date, end_date, note? }`. Validates `end_date >= start_date` (the DB constraint is defense-in-depth, not the primary validation). Checks for an overlapping pending/accepted booking request (service-role read, since checking across into `booking_requests` needs it) and includes a `warning` string in the response if found, but always creates the range regardless.
- `DELETE /api/blackout-dates/[id]` — RLS-scoped delete; a non-owner's row simply won't match the policy, so this can't leak or delete someone else's block.

## Out of Scope

- No recurring/repeating blackout patterns (e.g. "every Monday") — just explicit date ranges.
- No editing an existing range's dates — removing and re-adding covers that.
- No limit on how many ranges an artist can have, or how far in advance/past they can be set.

## Manual Verification

No automated test suite in this project. Verification is `npx tsc --noEmit` / `npx eslint` / `npm run build`, plus manual/live checks:

- Artist blocks a date range with a note → range appears on the calendar grid and in the Blocked Dates list; note is visible only to the artist.
- A venue viewing that artist's public profile can't select a blocked date in the booking request modal.
- A direct `POST /api/venue/booking-requests` call (bypassing the UI) for a blocked date is rejected with a 400, confirming server-side enforcement — same check for a date with an existing confirmed gig.
- Artist blocks a range overlapping an existing pending booking request → range is created, warning is shown, the existing booking request is untouched.
- Artist removes a blocked range → the date becomes selectable again for a venue.
