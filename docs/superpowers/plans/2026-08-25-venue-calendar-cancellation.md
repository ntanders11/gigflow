# Venue Calendar View & Two-Sided Booking Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the venue's flat booking list with a month-grid calendar, and let either a venue or an artist cancel a booking/gig — keeping both sides' records, notifications, and emails in sync.

**Architecture:** A new nullable `cancelled` status (plus a `cancelled_by` column) is added to `booking_requests`; a new venue-side PATCH route sets it and cascades to the linked gig, while the existing artist-side gig PATCH route grows a mirror-image branch that cascades back to `booking_requests`. A new calendar component reuses `/venue/bookings`'s existing data fetch, just changes how it's rendered.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS, service-role client for cross-user writes), date-fns, TypeScript. No automated test suite exists in this project — verification is `npx tsc --noEmit`, `npx eslint`, `npm run build`, and manual/live checks.

**Spec:** `docs/superpowers/specs/2026-08-25-venue-calendar-and-cancellation-design.md` — read this first for the full rationale behind every decision below.

**Worktree:** `.worktrees/venue-calendar-cancellation`, branch `feature/venue-calendar-cancellation`, based on `main`. All commands below assume you're already in that directory.

---

## File Map

- Create: `supabase/migrations/023_booking_cancellation.sql` — new status value + column, widened notification-type constraint.
- Modify: `types/index.ts` — widen `BookingRequestStatus`, add two `NotificationType` values, add `cancelled_by` to `BookingRequestRow` and `VenueBookingRequestView`.
- Modify: `lib/notifications/create.ts` — add the two new types to `PUSHABLE_TYPES`.
- Modify: `lib/email/booking-request-notifications.ts` — add `sendCancellationEmail`.
- Create: `lib/bookings/venue-auth.ts` — extracts `getOwnCompletedVenueProfile`, currently duplicated logic that only exists inline in the GET/POST route today; the new route needs the same check, so this pulls it out once rather than duplicating it a second time (mirrors the existing extraction precedent set by `lib/bookings/pipeline.ts`).
- Modify: `app/api/venue/booking-requests/route.ts` — use the extracted helper instead of its local copy; add `cancelled_by` to the GET response mapping.
- Create: `app/api/venue/booking-requests/[id]/route.ts` — new `PATCH` (venue cancels).
- Modify: `app/api/gigs/[id]/route.ts` — add `justCancelled` branch (artist cancels).
- Create: `components/venue/VenueBookingsCalendar.tsx` — the new month-grid view.
- Modify: `app/venue/bookings/page.tsx` — render the new calendar instead of the flat list.
- Modify: `components/venue/GigsSection.tsx` — add a "Cancel" button.
- Modify: `CLAUDE.md`, `CHANGELOG.md` — document the shipped feature.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/023_booking_cancellation.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/023_booking_cancellation.sql
-- Lets either party cancel a booking. Widens booking_requests.status to
-- add 'cancelled' and records who cancelled it; widens notifications.type
-- to add the two new notification types this triggers. gigs.status
-- already supports 'cancelled' (migration 007) — no change needed there.

alter table public.booking_requests
  drop constraint booking_requests_status_check;

alter table public.booking_requests
  add constraint booking_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled'));

alter table public.booking_requests
  add column cancelled_by text check (cancelled_by in ('artist', 'venue'));

alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent',
    'booking_cancelled_by_venue', 'booking_cancelled_by_artist'
  ));
```

- [ ] **Step 2: Verify constraint names**

Postgres auto-names an unnamed `check` constraint as `<table>_<column>_check`. Since both `booking_requests.status` and `notifications.type` used inline `check (...)` (not a named constraint) in their original `create table` statements (see `supabase/migrations/019_booking_requests.sql:29` and `supabase/migrations/021_notifications.sql:5-8`), the default names `booking_requests_status_check` and `notifications_type_check` are correct. No local database exists to test this against — Taylor will run this in the Supabase SQL Editor after merge, so double-check the exact table/column spelling against those two migration files one more time before moving on.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/023_booking_cancellation.sql
git commit -m "feat: add booking cancellation migration"
```

---

### Task 2: Type updates

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Widen `BookingRequestStatus` and add `cancelled_by` to the two booking-request types**

Find (around line 292):
```typescript
export type BookingRequestStatus = "pending" | "accepted" | "declined";
```
Replace with:
```typescript
export type BookingRequestStatus = "pending" | "accepted" | "declined" | "cancelled";
```

Find `BookingRequestRow` (around line 295-307) and add `cancelled_by` after `status`:
```typescript
export interface BookingRequestRow {
  id: string;
  venue_profile_id: string;
  artist_user_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  message: string | null;
  status: BookingRequestStatus;
  cancelled_by: "artist" | "venue" | null;
  gig_id: string | null;
  created_at: string;
  updated_at: string;
}
```

Find `VenueBookingRequestView` (around line 321-330) and add `cancelled_by` after `status`, so the calendar UI (Task 7) can show who cancelled a booking:
```typescript
export interface VenueBookingRequestView {
  id: string;
  artist_name: string;
  artist_photo_url: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  message: string | null;
  status: BookingRequestStatus;
  cancelled_by: "artist" | "venue" | null;
}
```

- [ ] **Step 2: Add the two new `NotificationType` values**

Find (around line 336-342):
```typescript
export type NotificationType =
  | "booking_request_received"
  | "booking_request_accepted"
  | "booking_request_declined"
  | "rating_available"
  | "rating_revealed"
  | "follow_up_sent";
```
Replace with:
```typescript
export type NotificationType =
  | "booking_request_received"
  | "booking_request_accepted"
  | "booking_request_declined"
  | "booking_cancelled_by_venue"
  | "booking_cancelled_by_artist"
  | "rating_available"
  | "rating_revealed"
  | "follow_up_sent";
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: one new error, in `app/venue/bookings/page.tsx`, because `STATUS_STYLE` is an exhaustive `Record` over `VenueBookingRequestView["status"]` and doesn't yet have a `cancelled` entry. That's expected — Task 8 replaces this file entirely. Confirm no *other* errors appear (there shouldn't be any — every other consumer of these types either doesn't switch exhaustively on them, or is a file this plan updates in a later task).

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "feat: add cancelled booking status and cancellation notification types"
```

---

### Task 3: Make cancellation notifications pushable

**Files:**
- Modify: `lib/notifications/create.ts`

- [ ] **Step 1: Add the two new types to `PUSHABLE_TYPES`**

Find:
```typescript
const PUSHABLE_TYPES = new Set<NotificationType>([
  "booking_request_received",
  "booking_request_accepted",
  "booking_request_declined",
]);
```
Replace with:
```typescript
const PUSHABLE_TYPES = new Set<NotificationType>([
  "booking_request_received",
  "booking_request_accepted",
  "booking_request_declined",
  "booking_cancelled_by_venue",
  "booking_cancelled_by_artist",
]);
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error from Task 2 Step 3 (in `app/venue/bookings/page.tsx`), nothing new.

- [ ] **Step 3: Commit**

```bash
git add lib/notifications/create.ts
git commit -m "feat: send push notifications for booking cancellations"
```

---

### Task 4: Cancellation emails

**Files:**
- Modify: `lib/email/booking-request-notifications.ts`

- [ ] **Step 1: Add `sendCancellationEmail`**

This file already has `sendSystemEmail` (a private helper) and two exported send functions following the same shape: look up who to email via the service-role client, bail quietly if no email is found, send a plain-text message. Add a third function at the end of the file that covers all three cancellation cases (venue-cancelled-pending, venue-cancelled-accepted, artist-cancelled) with one `cancelledBy` parameter, since the lookups needed (artist name, venue name, both logins) are the same shape as the existing `sendBookingResponseEmail` just with the recipient/subject flipped depending on who cancelled.

```typescript
// Fired from either cancellation route (venue cancelling, or the artist
// cancelling their gig) right after the booking_requests row is updated
// to status: "cancelled". `wasAccepted` controls wording only — a
// cancelled *pending* request reads as "withdrawn", a cancelled
// *accepted* one reads as "cancelled", since the artist already has it on
// their calendar in the second case.
export async function sendCancellationEmail(
  service: SupabaseClient,
  request: { venue_profile_id: string; artist_user_id: string; date: string },
  cancelledBy: "artist" | "venue",
  wasAccepted: boolean
): Promise<void> {
  const { data: venueProfile, error: venueError } = await service
    .from("venue_profiles")
    .select("user_id, venue_name")
    .eq("id", request.venue_profile_id)
    .maybeSingle();
  if (venueError) console.error("sendCancellationEmail: venue profile lookup failed", venueError);

  const { data: artistProfile, error: artistError } = await service
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", request.artist_user_id)
    .maybeSingle();
  if (artistError) console.error("sendCancellationEmail: artist profile lookup failed", artistError);

  const venueName = (venueProfile?.venue_name as string | null) ?? "The venue";
  const artistName = (artistProfile?.display_name as string | null) ?? "The artist";
  const verb = wasAccepted ? "cancelled" : "withdrawn";

  if (cancelledBy === "venue") {
    const { data: artistLogin, error: loginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", request.artist_user_id)
      .maybeSingle();
    if (loginError) console.error("sendCancellationEmail: artist login lookup failed", loginError);
    if (!artistLogin?.email) return;

    await sendSystemEmail(
      artistLogin.email as string,
      wasAccepted ? "A booking was cancelled" : "A booking request was withdrawn",
      `${venueName} ${verb} the booking for ${request.date}.`
    );
  } else {
    if (!venueProfile?.user_id) return;
    const { data: venueLogin, error: loginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", venueProfile.user_id as string)
      .maybeSingle();
    if (loginError) console.error("sendCancellationEmail: venue login lookup failed", loginError);
    if (!venueLogin?.email) return;

    await sendSystemEmail(
      venueLogin.email as string,
      "A booking was cancelled",
      `${artistName} cancelled the booking for ${request.date}.`
    );
  }
}
```

Note: an artist can only cancel a gig that's already `accepted` (there's no artist-facing concept of a "pending" gig), so `wasAccepted` is always `true` when `cancelledBy === "artist"` — the parameter only actually varies on the venue side. Keep it as one shared parameter anyway rather than splitting into two functions; the duplication of the branch would be worse than the one always-true call site.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error from Task 2, nothing new (this function isn't called from anywhere yet).

- [ ] **Step 3: Commit**

```bash
git add lib/email/booking-request-notifications.ts
git commit -m "feat: add booking cancellation email"
```

---

### Task 5: Extract the venue-profile auth helper

**Files:**
- Create: `lib/bookings/venue-auth.ts`
- Modify: `app/api/venue/booking-requests/route.ts`

**Why this task exists:** `app/api/venue/booking-requests/route.ts` currently defines `getOwnCompletedVenueProfile` as a local (unexported) function. Task 6 needs the exact same check in a second route file. Copy-pasting an auth-critical helper into two files risks them drifting apart later; extracting it once (the same pattern this codebase already uses for `lib/bookings/pipeline.ts`) avoids that.

- [ ] **Step 1: Create the shared helper**

```typescript
// lib/bookings/venue-auth.ts
import { SupabaseClient } from "@supabase/supabase-js";

// Resolves the calling user's own venue account, but only if they've
// finished signup (venue_name is set) — every booking-requests route
// needs this exact check before touching any booking_requests row, since
// the table itself carries no RLS policies (see
// supabase/migrations/019_booking_requests.sql's header comment).
export async function getOwnCompletedVenueProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("venue_profiles")
    .select("id, venue_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || !data.venue_name) return null;
  return { id: data.id as string };
}
```

- [ ] **Step 2: Update the existing route to import it instead**

In `app/api/venue/booking-requests/route.ts`, remove the local function definition (currently lines 9-20):
```typescript
async function getOwnCompletedVenueProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("venue_profiles")
    .select("id, venue_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || !data.venue_name) return null;
  return { id: data.id as string };
}
```
and instead import it:
```typescript
import { getOwnCompletedVenueProfile } from "@/lib/bookings/venue-auth";
```
The `SupabaseClient` import in this file may now be unused if nothing else in the file references it directly — check before removing it (it's still used as a type annotation on `service` in a couple of spots, so it likely stays; just confirm with the type-checker in the next step rather than guessing).

- [ ] **Step 3: Also add `cancelled_by` to the GET response mapping**

This route's `GET` handler maps raw `booking_requests` rows into `VenueBookingRequestView` objects (the `.select("*")` on line ~34 already pulls the new column once Task 1's migration runs — only the explicit mapping below needs updating). Find:
```typescript
  const requests: VenueBookingRequestView[] = (rows ?? []).map((r): VenueBookingRequestView => {
    const artist = artistByUserId.get(r.artist_user_id as string);
    return {
      id: r.id,
      artist_name: (artist?.display_name as string | null) ?? "An artist",
      artist_photo_url: (artist?.photo_url as string | null) ?? null,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      message: r.message,
      status: r.status,
    };
  });
```
Replace with:
```typescript
  const requests: VenueBookingRequestView[] = (rows ?? []).map((r): VenueBookingRequestView => {
    const artist = artistByUserId.get(r.artist_user_id as string);
    return {
      id: r.id,
      artist_name: (artist?.display_name as string | null) ?? "An artist",
      artist_photo_url: (artist?.photo_url as string | null) ?? null,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      message: r.message,
      status: r.status,
      cancelled_by: r.cancelled_by ?? null,
    };
  });
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error from Task 2 (in `app/venue/bookings/page.tsx`), nothing new. If `SupabaseClient` shows as an unused import, remove it.

- [ ] **Step 5: Commit**

```bash
git add lib/bookings/venue-auth.ts app/api/venue/booking-requests/route.ts
git commit -m "refactor: extract shared venue-profile auth helper"
```

---

### Task 6: Venue-side cancel route

**Files:**
- Create: `app/api/venue/booking-requests/[id]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/venue/booking-requests/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getOwnCompletedVenueProfile } from "@/lib/bookings/venue-auth";
import { sendCancellationEmail } from "@/lib/email/booking-request-notifications";
import { createNotification } from "@/lib/notifications/create";

// PATCH /api/venue/booking-requests/[id] — a venue withdraws a pending
// request or cancels an already-accepted booking. Body: { action: "cancel" }.
// A distinct body shape from the artist's accept/decline PATCH on
// /api/booking-requests/[id] (different file, different verb) rather than
// overloading `status` directly, so this endpoint can't be confused with
// that one.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (body.action !== "cancel") {
    return NextResponse.json({ error: "action must be 'cancel'" }, { status: 400 });
  }

  const venueProfile = await getOwnCompletedVenueProfile(supabase, user.id);
  if (!venueProfile) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const service = await createServiceClient();

  const { data: reqRow, error: fetchError } = await service
    .from("booking_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!reqRow) return NextResponse.json({ error: "Booking request not found" }, { status: 404 });
  if (reqRow.venue_profile_id !== venueProfile.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (reqRow.status === "declined" || reqRow.status === "cancelled") {
    return NextResponse.json({ error: "This booking can no longer be cancelled" }, { status: 409 });
  }

  const wasAccepted = reqRow.status === "accepted";

  const { data: updated, error: updateError } = await service
    .from("booking_requests")
    .update({ status: "cancelled", cancelled_by: "venue" })
    .eq("id", id)
    .in("status", ["pending", "accepted"])
    .select()
    .maybeSingle();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  if (!updated) {
    return NextResponse.json({ error: "This booking can no longer be cancelled" }, { status: 409 });
  }

  if (wasAccepted && reqRow.gig_id) {
    const { error: gigError } = await service
      .from("gigs")
      .update({ status: "cancelled" })
      .eq("id", reqRow.gig_id);
    if (gigError) console.error("PATCH /api/venue/booking-requests/[id]: failed to cancel linked gig", gigError);
  }

  try {
    await sendCancellationEmail(service, updated, "venue", wasAccepted);
  } catch (err) {
    console.error("PATCH /api/venue/booking-requests/[id]: failed to send cancellation email", err);
  }

  try {
    await createNotification(service, {
      userId: updated.artist_user_id,
      type: "booking_cancelled_by_venue",
      title: wasAccepted ? "A booking was cancelled" : "A booking request was withdrawn",
      link: "/calendar",
    });
  } catch (err) {
    console.error("PATCH /api/venue/booking-requests/[id]: failed to create notification", err);
  }

  return NextResponse.json(updated);
}
```

Note the `.in("status", ["pending", "accepted"])` on the update, mirroring the existing race-safety pattern in `app/api/booking-requests/[id]/route.ts` (the `.eq("status", "pending")` on its own updates) — it re-checks status at write time, not just at the earlier read, so two concurrent cancel attempts (or a cancel racing an artist's accept/decline) can't both "succeed."

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error from Task 2, nothing new.

Run: `npx eslint app/api/venue/booking-requests/`
Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add app/api/venue/booking-requests/\[id\]/route.ts
git commit -m "feat: let venues cancel a pending or accepted booking"
```

---

### Task 7: Artist-side cancel (extend the gig PATCH route)

**Files:**
- Modify: `app/api/gigs/[id]/route.ts`

- [ ] **Step 1: Add the `justCancelled` branch**

Find the existing `justCompleted` block:
```typescript
  const justCompleted = before?.status !== "completed" && data.status === "completed";
  if (justCompleted) {
    // venue_artist_ratings has no client-facing RLS policies (see
    // supabase/migrations/018_venue_artist_ratings.sql) — a read through
    // the ordinary `supabase` client above would silently return nothing
    // rather than error, making the re-fire guard inside
    // maybeSendNewGigToRateEmails a no-op. Must use the service-role
    // client for this side-effect, kept deliberately separate from the
    // RLS-scoped client used for the security-relevant gig update above.
    const service = await createServiceClient();
    try {
      await maybeSendNewGigToRateEmails(service, {
        artistUserId: user.id,
        venueId: data.venue_id,
      });
    } catch (err) {
      console.error("PATCH /api/gigs/[id]: failed to send new-gig-to-rate emails", err);
    }
  }

  return NextResponse.json(data);
```

Replace with:
```typescript
  const justCompleted = before?.status !== "completed" && data.status === "completed";
  if (justCompleted) {
    // venue_artist_ratings has no client-facing RLS policies (see
    // supabase/migrations/018_venue_artist_ratings.sql) — a read through
    // the ordinary `supabase` client above would silently return nothing
    // rather than error, making the re-fire guard inside
    // maybeSendNewGigToRateEmails a no-op. Must use the service-role
    // client for this side-effect, kept deliberately separate from the
    // RLS-scoped client used for the security-relevant gig update above.
    const service = await createServiceClient();
    try {
      await maybeSendNewGigToRateEmails(service, {
        artistUserId: user.id,
        venueId: data.venue_id,
      });
    } catch (err) {
      console.error("PATCH /api/gigs/[id]: failed to send new-gig-to-rate emails", err);
    }
  }

  const justCancelled = before?.status !== "cancelled" && data.status === "cancelled";
  if (justCancelled) {
    // booking_requests carries no client-facing RLS policies either (same
    // reasoning as above) — a gig only has a linked booking_requests row
    // if it originated from an accepted booking request (gig_id is set
    // there, never the other way around), so most cancelled gigs will
    // find nothing here and that's fine, not an error case.
    const service = await createServiceClient();
    const { data: linkedRequest, error: lookupError } = await service
      .from("booking_requests")
      .select("*")
      .eq("gig_id", id)
      .maybeSingle();
    if (lookupError) {
      console.error("PATCH /api/gigs/[id]: failed to look up linked booking request", lookupError);
    } else if (linkedRequest && linkedRequest.status !== "declined" && linkedRequest.status !== "cancelled") {
      const { data: updatedRequest, error: cancelError } = await service
        .from("booking_requests")
        .update({ status: "cancelled", cancelled_by: "artist" })
        .eq("id", linkedRequest.id)
        .select()
        .maybeSingle();
      if (cancelError) {
        console.error("PATCH /api/gigs/[id]: failed to cancel linked booking request", cancelError);
      } else if (updatedRequest) {
        try {
          await sendCancellationEmail(service, updatedRequest, "artist", true);
        } catch (err) {
          console.error("PATCH /api/gigs/[id]: failed to send cancellation email", err);
        }
        try {
          const { data: venueProfile } = await service
            .from("venue_profiles")
            .select("user_id")
            .eq("id", updatedRequest.venue_profile_id)
            .maybeSingle();
          if (venueProfile?.user_id) {
            await createNotification(service, {
              userId: venueProfile.user_id as string,
              type: "booking_cancelled_by_artist",
              title: "A booking was cancelled",
              link: "/venue/bookings",
            });
          }
        } catch (err) {
          console.error("PATCH /api/gigs/[id]: failed to create cancellation notification", err);
        }
      }
    }
  }

  return NextResponse.json(data);
```

- [ ] **Step 2: Add the two new imports at the top of the file**

Find:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { maybeSendNewGigToRateEmails } from "@/lib/email/rating-notifications";
```
Replace with:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { maybeSendNewGigToRateEmails } from "@/lib/email/rating-notifications";
import { sendCancellationEmail } from "@/lib/email/booking-request-notifications";
import { createNotification } from "@/lib/notifications/create";
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error from Task 2, nothing new.

Run: `npx eslint app/api/gigs/`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/gigs/\[id\]/route.ts
git commit -m "feat: let artists cancel a gig linked to a booking request"
```

---

### Task 8: Venue calendar component

**Files:**
- Create: `components/venue/VenueBookingsCalendar.tsx`

- [ ] **Step 1: Write the component**

```typescript
// components/venue/VenueBookingsCalendar.tsx
"use client";

import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from "date-fns";
import { useState } from "react";
import { VenueBookingRequestView } from "@/types";

const STATUS_DOT_COLOR: Record<VenueBookingRequestView["status"], string> = {
  pending: "#D4A64F",
  accepted: "#4caf7d",
  declined: "#9a9591",
  cancelled: "#e25c5c",
};

const STATUS_LABEL: Record<VenueBookingRequestView["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

function cancelledBySubLabel(r: VenueBookingRequestView): string | null {
  if (r.status !== "cancelled") return null;
  return r.cancelled_by === "artist" ? "Cancelled by the artist" : "Cancelled by you";
}

function DayDetailCard({ r, onCancelled }: { r: VenueBookingRequestView; onCancelled: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const canCancel = r.status === "pending" || r.status === "accepted";

  async function cancel() {
    if (!window.confirm(r.status === "accepted"
      ? "Cancel this booking? The artist will be notified and it will be removed from their calendar."
      : "Withdraw this booking request? The artist will be notified.")) {
      return;
    }
    setCancelling(true);
    setError("");
    const res = await fetch(`/api/venue/booking-requests/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    setCancelling(false);
    if (res.ok) {
      onCancelled();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't cancel — please try again.");
    }
  }

  return (
    <div
      className="rounded-xl p-4 flex items-center gap-4"
      style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {r.artist_photo_url ? (
        <img src={r.artist_photo_url} alt={r.artist_name} className="w-10 h-10 rounded-full object-cover shrink-0" />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
          style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
        >
          {r.artist_name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>{r.artist_name}</div>
        <div className="text-xs" style={{ color: "#9a9591" }}>
          {r.date}{r.start_time ? ` · ${r.start_time}` : ""}{r.end_time ? `–${r.end_time}` : ""}
        </div>
        {r.message && (
          <div className="text-xs mt-1" style={{ color: "#5e5c58" }}>{r.message}</div>
        )}
        {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span
          className="text-xs px-2.5 py-1 rounded-full"
          style={{ backgroundColor: `${STATUS_DOT_COLOR[r.status]}26`, color: STATUS_DOT_COLOR[r.status] }}
        >
          {STATUS_LABEL[r.status]}
        </span>
        {cancelledBySubLabel(r) && (
          <span className="text-xs" style={{ color: "#5e5c58" }}>{cancelledBySubLabel(r)}</span>
        )}
        {canCancel && (
          <button
            onClick={cancel}
            disabled={cancelling}
            className="text-xs px-2.5 py-1 rounded-lg transition-all hover:brightness-125"
            style={{ background: "rgba(226,92,92,0.1)", color: "#e25c5c", opacity: cancelling ? 0.6 : 1 }}
          >
            {cancelling ? "Cancelling…" : "Cancel booking"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function VenueBookingsCalendar({
  requests,
  onChanged,
}: {
  requests: VenueBookingRequestView[];
  onChanged: () => void;
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  function requestsOnDay(day: Date) {
    return requests.filter((r) => isSameDay(new Date(r.date + "T12:00:00"), day));
  }

  const selectedDayRequests = selectedDay ? requestsOnDay(selectedDay) : [];

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="px-3 py-1.5 rounded-lg text-sm transition-all"
          style={{ color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          ← Prev
        </button>
        <h2 className="text-lg font-semibold" style={{ color: "#F4E8D2" }}>
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <button
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="px-3 py-1.5 rounded-lg text-sm transition-all"
          style={{ color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          Next →
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-2">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="text-center text-xs font-semibold uppercase tracking-widest py-2"
            style={{ color: "#5e5c58" }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div
        className="grid grid-cols-7 rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {days.map((day, idx) => {
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          const dayRequests = requestsOnDay(day);

          return (
            <button
              key={idx}
              onClick={() => setSelectedDay(dayRequests.length > 0 ? day : null)}
              className="min-h-[90px] p-2 text-left transition-all"
              style={{
                backgroundColor: isSelected ? "rgba(212,166,79,0.08)" : isCurrentMonth ? "#16181c" : "#13141700",
                borderRight: (idx + 1) % 7 === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                borderBottom: idx < days.length - 7 ? "1px solid rgba(255,255,255,0.05)" : "none",
                cursor: dayRequests.length > 0 ? "pointer" : "default",
              }}
            >
              <div
                className="text-xs font-medium mb-1.5 w-6 h-6 flex items-center justify-center rounded-full"
                style={{
                  color: isToday ? "#0E0E10" : isCurrentMonth ? "#9a9591" : "#2e2c28",
                  backgroundColor: isToday ? "#D4A64F" : "transparent",
                  fontWeight: isToday ? 700 : 400,
                }}
              >
                {format(day, "d")}
              </div>
              <div className="flex flex-wrap gap-1">
                {dayRequests.map((r) => (
                  <span
                    key={r.id}
                    title={`${r.artist_name} — ${STATUS_LABEL[r.status]}`}
                    style={{
                      width: "7px", height: "7px", borderRadius: "999px",
                      backgroundColor: STATUS_DOT_COLOR[r.status],
                      display: "inline-block",
                    }}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected day detail panel */}
      {selectedDay && selectedDayRequests.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: "#9a9591" }}>
            {format(selectedDay, "EEEE, MMMM d")}
          </h3>
          <div className="space-y-3">
            {selectedDayRequests.map((r) => (
              <DayDetailCard key={r.id} r={r} onCancelled={onChanged} />
            ))}
          </div>
        </div>
      )}

      {requests.length === 0 && (
        <p className="text-sm mt-8" style={{ color: "#5e5c58" }}>
          You haven&apos;t sent any booking requests yet.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error from Task 2 (in `app/venue/bookings/page.tsx`), nothing new — this file isn't imported anywhere yet.

- [ ] **Step 3: Commit**

```bash
git add components/venue/VenueBookingsCalendar.tsx
git commit -m "feat: add venue bookings calendar component"
```

---

### Task 9: Wire the calendar into the bookings page

**Files:**
- Modify: `app/venue/bookings/page.tsx`

- [ ] **Step 1: Replace the flat-list rendering with the calendar**

Replace the entire file:
```typescript
// app/venue/bookings/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import VenueNav from "@/components/venue/VenueNav";
import VenueBookingsCalendar from "@/components/venue/VenueBookingsCalendar";
import { VenueBookingRequestView } from "@/types";

export default function VenueBookingsPage() {
  const [requests, setRequests] = useState<VenueBookingRequestView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    return fetch("/api/venue/booking-requests")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
      <VenueNav />
      {!loading && (
        <div className="max-w-2xl mx-auto px-6 py-10">
          <h1 className="text-xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Bookings</h1>
          <VenueBookingsCalendar requests={requests} onChanged={load} />
        </div>
      )}
    </div>
  );
}
```

This drops the old `STATUS_STYLE` map entirely (it lived only in this file, replaced by the equivalent maps now inside `VenueBookingsCalendar.tsx`) — that's what resolves the pre-existing `tsc` error from Task 2.

- [ ] **Step 2: Verify it compiles clean**

Run: `npx tsc --noEmit`
Expected: **no errors at all** — this was the last file with the pre-existing error from Task 2, so the project should be fully clean now.

Run: `npx eslint app/venue/bookings/ components/venue/VenueBookingsCalendar.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/venue/bookings/page.tsx
git commit -m "feat: replace venue bookings list with calendar view"
```

---

### Task 10: Artist-side cancel button

**Files:**
- Modify: `components/venue/GigsSection.tsx`

- [ ] **Step 1: Add a "Cancel" button next to the existing "✓ Done" button**

Find (around lines 223-231):
```typescript
                    {gig.status === "upcoming" && (
                      <button
                        onClick={() => markStatus(gig.id, "completed")}
                        className="text-xs px-2 py-1 rounded-lg transition-all hover:brightness-125"
                        style={{ background: "rgba(76,175,125,0.15)", color: "#4caf7d", border: "1px solid rgba(76,175,125,0.3)" }}
                      >
                        ✓ Done
                      </button>
                    )}
```
Replace with:
```typescript
                    {gig.status === "upcoming" && (
                      <button
                        onClick={() => markStatus(gig.id, "completed")}
                        className="text-xs px-2 py-1 rounded-lg transition-all hover:brightness-125"
                        style={{ background: "rgba(76,175,125,0.15)", color: "#4caf7d", border: "1px solid rgba(76,175,125,0.3)" }}
                      >
                        ✓ Done
                      </button>
                    )}
                    {gig.status === "upcoming" && (
                      <button
                        onClick={() => {
                          if (window.confirm("Cancel this gig? The venue will be notified.")) {
                            markStatus(gig.id, "cancelled");
                          }
                        }}
                        className="text-xs px-2 py-1 rounded-lg transition-all hover:brightness-125"
                        style={{ background: "rgba(226,92,92,0.1)", color: "#e25c5c", border: "1px solid rgba(226,92,92,0.25)" }}
                      >
                        Cancel
                      </button>
                    )}
```

No changes needed to `markStatus` itself (lines 68-77) — it already does exactly `PATCH /api/gigs/${id}` with `{ status }` and updates local state on success, which is all a cancel needs. The row's existing dimmed/red-bordered "Cancelled" styling (`STATUS_STYLE.cancelled`, `opacity: gig.status === "cancelled" ? 0.5 : 1` at line 191) already handles displaying the result — it's just been unreachable until now.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint components/venue/GigsSection.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/venue/GigsSection.tsx
git commit -m "feat: let artists cancel an upcoming gig"
```

---

### Task 11: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md's "Booking Requests" section**

Find the existing "Booking Requests" paragraph (in the Key Flows section, describing the fourth venue-portal piece) and add a sentence covering cancellation and the calendar view — e.g.:

> Either side can cancel a booking: a venue cancels (or withdraws a still-pending request) from its own calendar view at `/venue/bookings` (now a month grid, `components/venue/VenueBookingsCalendar.tsx`, mirroring the artist's Calendar page style — replacing the old flat list), via `PATCH /api/venue/booking-requests/[id]`; an artist cancels their existing gig (a new "Cancel" option next to the existing "Done"/delete controls in `components/venue/GigsSection.tsx`), which `PATCH /api/gigs/[id]` syncs back to the linked `booking_requests` row if one exists. Whichever side cancels, the other is notified (email + in-app/push) and the record on both sides reflects it — `booking_requests.status` gained a fourth value, `cancelled`, plus a `cancelled_by` column (`'artist' | 'venue'`), added in migration `023_booking_cancellation.sql`.

Read the exact current wording of that section first (it's the paragraph starting "Booking Requests — the fourth and final piece of the venue portal...") and insert this as an additional sentence at the end, keeping the rest unchanged.

- [ ] **Step 2: Add a CHANGELOG.md entry**

Read `CHANGELOG.md`'s current top entry first to match its existing formatting exactly, then prepend (today's date — check the actual current date rather than assuming):

```
## YYYY-MM-DD
- [Feature] Venue's Bookings page is now a calendar. `/venue/bookings` shows a month grid with color-coded dots for pending, accepted, declined, and cancelled bookings — tap a day to see full details, same as before.
- [Feature] Cancel a booking from either side. A venue can cancel or withdraw a booking request right from the new calendar. An artist can now cancel a gig from the venue's page (next to "Done"), which was missing before. Whichever side cancels, the other person gets an email and an in-app/phone notification, so nobody's left wondering why a gig disappeared.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document venue calendar and booking cancellation"
```

---

### Task 12: Full verification and manual test

**Files:** none (verification only)

- [ ] **Step 1: Full project build**

Run: `npm run build`
Expected: builds successfully with no errors.

- [ ] **Step 2: Lint**

Run: `npx eslint .`
Expected: no new errors compared to `main`'s pre-existing baseline (this project has a known pre-existing lint count unrelated to this feature — compare against `main` if unsure, don't chase unrelated warnings).

- [ ] **Step 3: Live manual test, if test accounts are available**

Taylor has used a real venue test account and a real artist test account earlier this session to test the accept/decline flow live. If both are still available and logged in (one per browser/session, same as before), walk through:

1. As the venue: send a booking request to the artist test account (or reuse an existing pending one), then go to `/venue/bookings` and confirm the new calendar renders, showing a gold dot on the right day.
2. As the venue: tap that day, confirm the detail panel shows the request with a "Cancel booking" button, click it, confirm the artist gets notified (bell + email) and the dot turns red.
3. As the venue: send a fresh request, and as the artist, accept it (existing flow, unchanged). Confirm it now shows as a green dot on the venue's calendar.
4. As the venue: cancel the now-accepted booking. Confirm: the artist's gig disappears from their active `/calendar` view, the venue's dot turns red, and the artist is notified.
5. As the artist: on a *different* gig (create a fresh accepted booking first, following the same accept flow), open the venue detail page and click the new "Cancel" button next to "✓ Done". Confirm: the gig shows as cancelled (dimmed, red border) on the artist's side, and the venue's calendar shows that booking cancelled with "Cancelled by the artist" and is notified.

- [ ] **Step 4: If live test accounts are not available**

Fall back to static verification only: confirm the build is clean (Steps 1-2 above), and manually re-read through the two new/modified API routes (`app/api/venue/booking-requests/[id]/route.ts` and the `justCancelled` branch in `app/api/gigs/[id]/route.ts`) one more time end-to-end, tracing exactly what each database write and notification call does for each of the four scenarios in Step 3, to catch anything a live click-through would have caught. Report clearly to Taylor that full live end-to-end testing (across both a real venue and artist account, in real time) still needs to happen after this ships — this is the fallback, not a substitute for it being done at some point.

- [ ] **Step 5: Report the migration to Taylor**

Whichever path was taken above, remind Taylor that `supabase/migrations/023_booking_cancellation.sql` still needs to be run manually in the Supabase SQL Editor before any of this works in production — same as every other migration this session, since there's no direct database access from this environment.
