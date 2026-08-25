# Venue Calendar & Booking Cancellation — Design

## Overview

Two related pieces of work, approved together in one conversation:

1. Replace the flat list at `/venue/bookings` with a month-grid calendar (mirroring the artist's own Booking Calendar), color-coded by status, with a tap-to-expand day detail panel.
2. Let either party — venue or artist — cancel a booking, keeping both sides' records and notifications in sync, closing the gap where one side cancels and the other never finds out.

## Part 1: Venue Calendar View

### Current state

`app/venue/bookings/page.tsx` renders a flat list of every `VenueBookingRequestView` row fetched from `GET /api/venue/booking-requests`, each with a status badge (pending/accepted/declined).

### New design

Same URL, same nav link, same data source (`GET /api/venue/booking-requests` — unchanged). Client-side, replace the flat-list rendering with a month grid:

- New component `components/venue/VenueBookingsCalendar.tsx`. It uses the same date-fns month-grid building blocks as the artist's `components/calendar/CalendarView.tsx` (`startOfMonth`/`endOfMonth`/`startOfWeek`/`endOfWeek`/`eachDayOfInterval`), but is its own component rather than a shared/extracted one — `CalendarView`'s props and extra behavior (ICS subscription box, `Venue` type keyed off gig/pipeline shape) don't fit this page, and forcing a shared abstraction is a bigger refactor than this feature calls for.
- Each day cell shows a small colored dot per booking on that day: gold `#D4A64F` = pending, green `#4caf7d` = accepted, gray `#9a9591` = declined, red `#e25c5c` = cancelled — reusing the color conventions already used by the existing list's `STATUS_STYLE` and by `GigsSection`'s gig-status colors.
- Tapping a day opens a details panel below the grid listing every booking on that day, using the same card layout the current flat list already has (artist name/photo, date/time, message, status badge) — plus, per Part 2, a "Cancel booking" action on any pending or accepted card.
- Month prev/next navigation, matching `CalendarView`'s existing button styling.
- Every booking request always has a non-null `date` (schema constraint), so there's no "no date" case to handle, unlike the artist calendar's `follow_up_date` which can be null.

## Part 2: Two-Sided Cancellation

### Data model changes

New migration `supabase/migrations/023_booking_cancellation.sql`:

- Widen `booking_requests.status`'s check constraint to add `'cancelled'`:
  `check (status in ('pending', 'accepted', 'declined', 'cancelled'))`.
- Add a nullable column `cancelled_by text check (cancelled_by in ('artist', 'venue'))`, set only when `status` becomes `'cancelled'`.
- No change needed to `gigs` — `status` already supports `'cancelled'` (migration `007_gigs_table.sql`); no code path writes it today, but the column and display styling already exist.

### New notification types

Add two values to `NotificationType` (`types/index.ts`): `"booking_cancelled_by_venue"` and `"booking_cancelled_by_artist"`. Both are added to `PUSHABLE_TYPES` in `lib/notifications/create.ts` — a cancellation is time-sensitive news worth a phone alert, same tier as the three existing booking-related types.

### Venue cancels (pending or accepted)

New route `app/api/venue/booking-requests/[id]/route.ts`, exporting `PATCH`, body `{ action: "cancel" }` (a distinct shape from the artist's existing accept/decline PATCH, to avoid any ambiguity — this is a new file and does not modify the existing `app/api/booking-requests/[id]/route.ts`).

- Auth: resolve the caller's own completed venue profile (reuse the existing `getOwnCompletedVenueProfile` helper pattern from `app/api/venue/booking-requests/route.ts`), then confirm the target row's `venue_profile_id` matches it.
- Reject (409) if the row's current `status` is already `'declined'` or `'cancelled'`.
- Update: `status = 'cancelled'`, `cancelled_by = 'venue'`.
- If the row's prior `status` was `'accepted'` (meaning it has a `gig_id`), also update that gig to `status = 'cancelled'`.
- Either way, notify + email the artist: reuse the `createNotification` pattern and extend `lib/email/booking-request-notifications.ts` with a new `sendCancellationEmail` function, with wording that branches on whether the booking was still pending ("withdrawn") or already accepted ("cancelled"). Notification type `booking_cancelled_by_venue`, link `/calendar`.

### Artist cancels (their gig)

Extend the existing `PATCH` handler in `app/api/gigs/[id]/route.ts`, mirroring its existing `justCompleted` pattern:

- Add `justCancelled = before?.status !== "cancelled" && data.status === "cancelled"`.
- On that transition, using a service-role client (same reasoning as the existing `justCompleted` branch — `booking_requests` carries no client-facing RLS), look up `booking_requests where gig_id = <this gig's id>`.
- If a matching row is found and its `status` isn't already `'declined'`/`'cancelled'`: set `status = 'cancelled'`, `cancelled_by = 'artist'`; notify + email the venue (the counterpart case of `sendCancellationEmail`). Notification type `booking_cancelled_by_artist`, link `/venue/bookings`.
- If no linked `booking_requests` row exists (a gig added directly from the pipeline, never a booking request), this is a no-op beyond the ordinary gig update — nothing else to sync.

### UI entry points

- **Venue side**: "Cancel booking" button in the calendar's day-detail panel (Part 1), shown for bookings with status `pending` or `accepted`. A confirm step precedes the actual call. Calls the new venue-side cancel endpoint above.
- **Artist side**: new "Cancel" button in `components/venue/GigsSection.tsx`, next to the existing "✓ Done" button, shown only when `gig.status === "upcoming"`. A confirm step precedes the call. Calls the existing `markStatus(gig.id, "cancelled")` function already defined in that file (no change needed there) — the display styling for a cancelled gig (dimmed opacity, red left border, "Cancelled" label) already exists in `STATUS_STYLE` and is simply unreachable today.

### Out of scope

- No "undo cancel" — cancelling is final, matching how "declined" already behaves.
- No cancellation-reason field — keep the confirm step a plain yes/no, matching this app's existing lightweight interaction style elsewhere (e.g. decline has no reason field either).

## Manual Verification

No automated test suite exists in this project. Verification is `npx tsc --noEmit` / `npx eslint` / `npm run build`, plus live manual checks:

- Venue cancels a still-pending request → artist is notified (bell + push + email), the request disappears from the artist's actionable pending list.
- Venue cancels an already-accepted booking → the artist's gig disappears from their active Booking Calendar (already filtered via the page's existing `.neq("status", "cancelled")`) and shows as cancelled on the venue detail page's Gig Dates section; artist is notified.
- Artist cancels a gig that's linked to a booking request → the venue's calendar shows that booking as cancelled; venue is notified.
- Artist cancels a gig with no linked booking request (added directly via the pipeline) → cancels normally with no error, confirming the lookup-finds-nothing path doesn't break anything.
