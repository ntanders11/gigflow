# Artist Blackout Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an artist block off date ranges as unavailable on their Booking Calendar, so a venue can't request (or force through the API) a booking on those dates — and, in the same pass, close the existing gap where a venue's booking request for an already-booked gig date isn't actually rejected server-side today.

**Architecture:** A new `artist_blackout_dates` table (the first table this session to use a normal client-facing RLS policy instead of the service-role-only pattern, since it's single-owner data). A shared `lib/bookings/availability.ts` module provides both the full-list lookup the public availability endpoint already needs and a single-date check that's new — used to actually reject an unavailable booking request server-side. The Booking Calendar page grows a "Blocked Dates" section (form + list) and grid markers.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS, date-fns for calendar math), TypeScript. No automated test suite exists in this project — verification is `npx tsc --noEmit`, `npx eslint`, `npm run build`, and manual/live checks.

**Spec:** `docs/superpowers/specs/2026-09-01-artist-blackout-dates-design.md` — read this first for the full rationale behind every decision below.

**Worktree:** `.worktrees/artist-blackout-dates`, branch `feature/artist-blackout-dates`, based on `main`. All commands below assume you're already in that directory.

## Global Constraints

- `artist_blackout_dates` gets a normal owner-only RLS policy (`auth.uid() = user_id`, `for all`) — NOT the "no policies, service-role only" pattern used by `booking_requests`, `venue_artist_ratings`, `notifications`, and `push_subscriptions` earlier this session. This means the artist's own routes (`GET`/`POST /api/blackout-dates`, `DELETE /api/blackout-dates/[id]`) use the ordinary RLS-scoped `createClient()`, not `createServiceClient()`. Only reach for `createServiceClient()` in this feature where a route needs to read `booking_requests` (which still has no policies of its own) or read another artist's blackout dates from a public, unauthenticated context (the availability endpoint).
- `note` on a blackout date is private to the artist — never include it in any response reachable by a venue.
- Blocking a date range never touches, cancels, or modifies any existing gig or booking request — it only ever affects what NEW requests can be submitted going forward.

---

## File Map

- Create: `supabase/migrations/025_artist_blackout_dates.sql` — new table + owner RLS policy.
- Modify: `types/index.ts` — add `BlackoutDate` interface.
- Create: `lib/bookings/availability.ts` — `getUnavailableDates` and `isDateUnavailable`, shared by the read-only hint endpoint and the new server-side enforcement.
- Modify: `app/api/public/artists/[id]/availability/route.ts` — use `getUnavailableDates` instead of its current inline gigs-only query.
- Modify: `app/api/venue/booking-requests/route.ts` — reject a booking request for an unavailable date (the actual bug fix).
- Create: `app/api/blackout-dates/route.ts` — `GET` (list own ranges) and `POST` (create a range, with a non-blocking conflict warning).
- Create: `app/api/blackout-dates/[id]/route.ts` — `DELETE` (remove a range).
- Modify: `app/(protected)/calendar/page.tsx` — fetch the artist's own blackout dates, pass to `CalendarView`.
- Modify: `components/calendar/CalendarView.tsx` — "Blocked Dates" section (form + list) and grid markers.
- Modify: `CLAUDE.md`, `CHANGELOG.md` — document the shipped feature.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/025_artist_blackout_dates.sql`

**Interfaces:**
- Produces: table `public.artist_blackout_dates(id, user_id, start_date, end_date, note, created_at, updated_at)`, consumed by every task from Task 3 onward.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/025_artist_blackout_dates.sql
-- Lets an artist mark date ranges as unavailable, so a venue can't
-- request a booking on those dates. Unlike most tables added this
-- session (booking_requests, venue_artist_ratings, notifications,
-- push_subscriptions), this one gets a REAL client-facing RLS policy
-- instead of "no policies, service-role only" — every row here is
-- owned and written by exactly one party (the artist), with no second
-- party ever writing to it. A venue only ever reads another artist's
-- blackout ranges indirectly, through the public availability endpoint
-- (already using a service-role client, same as it reads gigs today).

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

- [ ] **Step 2: Verify the referenced trigger function exists**

`update_updated_at()` is already defined in `supabase/migrations/001_initial_schema.sql:104` and reused by several later migrations (e.g. `002_artist_profile.sql:30`, `003_invoices.sql:38`) — confirm this by reading `001_initial_schema.sql` around that line. No new function needed. There's no local database in this environment to actually run this against — Taylor will run it in the Supabase SQL Editor after merge, so double-check the exact spelling of `profiles`, `artist_blackout_dates`, and every column name one more time before moving on.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/025_artist_blackout_dates.sql
git commit -m "feat: add artist blackout dates migration"
```

---

### Task 2: Type definition

**Files:**
- Modify: `types/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BlackoutDate { id: string; start_date: string; end_date: string; note: string | null }`, consumed by Tasks 4, 5, 6, 8, 9.

- [ ] **Step 1: Add the `BlackoutDate` interface**

Read `types/index.ts` first to find the `GIGS` section (search for `// GIGS` and the `Gig` interface) and add this new interface directly after it, before the `ARTIST PROFILE` section:

```typescript
// ============================================================
// ARTIST BLACKOUT DATES
// ============================================================

// A date range an artist has marked themselves unavailable for. Client
// shape only — deliberately omits user_id/created_at/updated_at, which
// no consumer of this type needs.
export interface BlackoutDate {
  id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  note: string | null;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (this type isn't consumed anywhere yet).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add BlackoutDate type"
```

---

### Task 3: Shared availability helper

**Files:**
- Create: `lib/bookings/availability.ts`

**Interfaces:**
- Consumes: `artist_blackout_dates` table (Task 1), `gigs` table (existing).
- Produces: `getUnavailableDates(service: SupabaseClient, artistUserId: string): Promise<string[]>` and `isDateUnavailable(service: SupabaseClient, artistUserId: string, date: string): Promise<boolean>`, both consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the helper module**

```typescript
// lib/bookings/availability.ts
import { SupabaseClient } from "@supabase/supabase-js";

// Every individual date (YYYY-MM-DD) an artist is unavailable on:
// each upcoming confirmed gig's date, plus every day inside each
// blackout range, expanded individually. Used by the public
// availability endpoint to build the full "can't pick this date" set
// for a booking request's date picker — a list, not a single check,
// so it can be large; that's fine, callers just need a Set/array of
// strings, not a bounded response.
export async function getUnavailableDates(
  service: SupabaseClient,
  artistUserId: string
): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: gigRows } = await service
    .from("gigs")
    .select("date")
    .eq("user_id", artistUserId)
    .eq("status", "upcoming")
    .gte("date", today);

  const { data: blackoutRows } = await service
    .from("artist_blackout_dates")
    .select("start_date, end_date")
    .eq("user_id", artistUserId)
    .gte("end_date", today);

  const dates = new Set<string>((gigRows ?? []).map((r) => r.date as string));

  for (const row of blackoutRows ?? []) {
    // Iterate in UTC to avoid a local-timezone DST edge accidentally
    // skipping or repeating a day when adding 24 hours.
    let cursor = new Date(`${row.start_date}T00:00:00Z`);
    const end = new Date(`${row.end_date}T00:00:00Z`);
    while (cursor <= end) {
      dates.add(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  return Array.from(dates);
}

// A single-date check via two targeted point queries, used by the new
// server-side booking-request enforcement (POST
// /api/venue/booking-requests). Deliberately NOT implemented by calling
// getUnavailableDates and checking membership — that would mean
// generating a potentially large list just to check one date.
export async function isDateUnavailable(
  service: SupabaseClient,
  artistUserId: string,
  date: string
): Promise<boolean> {
  const { data: gigRow } = await service
    .from("gigs")
    .select("id")
    .eq("user_id", artistUserId)
    .eq("status", "upcoming")
    .eq("date", date)
    .maybeSingle();
  if (gigRow) return true;

  const { data: blackoutRow } = await service
    .from("artist_blackout_dates")
    .select("id")
    .eq("user_id", artistUserId)
    .lte("start_date", date)
    .gte("end_date", date)
    .maybeSingle();
  return !!blackoutRow;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (nothing imports this file yet).

- [ ] **Step 3: Commit**

```bash
git add lib/bookings/availability.ts
git commit -m "feat: add shared artist availability helper"
```

---

### Task 4: Wire the availability helper into the public endpoint

**Files:**
- Modify: `app/api/public/artists/[id]/availability/route.ts`

**Interfaces:**
- Consumes: `getUnavailableDates` (Task 3).
- Produces: no change to this route's response shape (`{ dates: string[] }`) — `components/booking/RequestToBookButton.tsx`'s `RequestBookingModal` needs zero changes.

- [ ] **Step 1: Replace the file**

Current content (confirm this matches before replacing — it's a short file):

```typescript
// app/api/public/artists/[id]/availability/route.ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = await createServiceClient();

  const today = new Date().toISOString().slice(0, 10);
  const { data: rows, error } = await service
    .from("gigs")
    .select("date")
    .eq("user_id", id)
    .eq("status", "upcoming")
    .gte("date", today);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const dates = (rows ?? []).map((r) => r.date as string);
  return NextResponse.json({ dates });
}
```

Replace with:

```typescript
// app/api/public/artists/[id]/availability/route.ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getUnavailableDates } from "@/lib/bookings/availability";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = await createServiceClient();
  const dates = await getUnavailableDates(service, id);
  return NextResponse.json({ dates });
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint app/api/public/artists/`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/public/artists/\[id\]/availability/route.ts
git commit -m "feat: include blackout dates in the public availability check"
```

---

### Task 5: Server-side enforcement on booking request creation

**Files:**
- Modify: `app/api/venue/booking-requests/route.ts`

**Interfaces:**
- Consumes: `isDateUnavailable` (Task 3).

This is the actual fix for the gap found while scoping this feature: today, nothing server-side stops a venue from creating a booking request for a date the artist already has a confirmed gig on — only a disabled Submit button (client-side only) does. This task closes that for BOTH existing gigs and the new blackout dates, since both flow through the same helper.

- [ ] **Step 1: Add the import and the check**

Find (top of file):
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getOwnCompletedVenueProfile } from "@/lib/bookings/venue-auth";
import { sendNewBookingRequestEmail } from "@/lib/email/booking-request-notifications";
import { createNotification } from "@/lib/notifications/create";
import { VenueBookingRequestView } from "@/types";
```
Replace with:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getOwnCompletedVenueProfile } from "@/lib/bookings/venue-auth";
import { sendNewBookingRequestEmail } from "@/lib/email/booking-request-notifications";
import { createNotification } from "@/lib/notifications/create";
import { isDateUnavailable } from "@/lib/bookings/availability";
import { VenueBookingRequestView } from "@/types";
```

Find, inside `POST`:
```typescript
  const service = await createServiceClient();

  const { data: targetArtist } = await service
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", artist_user_id)
    .maybeSingle();
  if (!targetArtist?.display_name) {
    return NextResponse.json({ error: "That artist could not be found" }, { status: 404 });
  }

  const { data: created, error } = await service
```
Replace with:
```typescript
  const service = await createServiceClient();

  const { data: targetArtist } = await service
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", artist_user_id)
    .maybeSingle();
  if (!targetArtist?.display_name) {
    return NextResponse.json({ error: "That artist could not be found" }, { status: 404 });
  }

  if (await isDateUnavailable(service, artist_user_id, date)) {
    return NextResponse.json({ error: "This artist isn't available on that date." }, { status: 400 });
  }

  const { data: created, error } = await service
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint app/api/venue/booking-requests/route.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/venue/booking-requests/route.ts
git commit -m "fix: reject booking requests for unavailable dates server-side"
```

---

### Task 6: Blackout dates CRUD API

**Files:**
- Create: `app/api/blackout-dates/route.ts` (`GET`, `POST`)
- Create: `app/api/blackout-dates/[id]/route.ts` (`DELETE`)

**Interfaces:**
- Consumes: `artist_blackout_dates` table (Task 1), the RLS-scoped `createClient()` and `createServiceClient()` from `@/lib/supabase/server` (existing).
- Produces: `GET /api/blackout-dates` → `{ blackoutDates: BlackoutDate[] }`; `POST /api/blackout-dates` → the created `BlackoutDate` fields plus an optional `warning: string`; `DELETE /api/blackout-dates/[id]` → `{ success: true }`. Consumed by Task 8.

Per the Global Constraints above: `GET`, `POST`'s insert, and `DELETE` all use the plain RLS-scoped `createClient()` — this table has a real owner-only policy, so there is no need for `createServiceClient()` there. `POST` additionally uses `createServiceClient()` ONLY for its conflict-check read against `booking_requests`, which has no RLS policies of its own (an RLS-scoped read of it would silently return nothing rather than error).

- [ ] **Step 1: Write `app/api/blackout-dates/route.ts`**

```typescript
// app/api/blackout-dates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Every blackout range the logged-in artist has set, soonest first.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("artist_blackout_dates")
    .select("id, start_date, end_date, note")
    .eq("user_id", user.id)
    .order("start_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ blackoutDates: data ?? [] });
}

// Creates a new blackout range. Never blocked by an existing booking on
// the same dates — just returns a non-blocking `warning` if one exists,
// so the artist knows without the range creation failing.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { start_date, end_date, note } = body;

  if (!start_date || !end_date) {
    return NextResponse.json({ error: "start_date and end_date are required" }, { status: 400 });
  }
  if (end_date < start_date) {
    return NextResponse.json({ error: "End date must be on or after the start date" }, { status: 400 });
  }

  const { data: created, error } = await supabase
    .from("artist_blackout_dates")
    .insert({ user_id: user.id, start_date, end_date, note: note || null })
    .select("id, start_date, end_date, note")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // booking_requests has no RLS policies of its own (see
  // supabase/migrations/019_booking_requests.sql's header comment) — a
  // read through the ordinary `supabase` client above would silently
  // return nothing rather than error, making this conflict check a
  // silent no-op. Needs the service-role client.
  const service = await createServiceClient();
  const { data: conflicts } = await service
    .from("booking_requests")
    .select("date")
    .eq("artist_user_id", user.id)
    .in("status", ["pending", "accepted"])
    .gte("date", start_date)
    .lte("date", end_date);

  let warning: string | undefined;
  if (conflicts && conflicts.length > 0) {
    warning = conflicts.length === 1
      ? `You already have a booking on ${conflicts[0].date} — this won't cancel it, but nothing new can be booked in this range.`
      : `You already have ${conflicts.length} bookings in this range — they won't be cancelled, but nothing new can be booked in this range.`;
  }

  return NextResponse.json({ ...created, warning });
}
```

- [ ] **Step 2: Write `app/api/blackout-dates/[id]/route.ts`**

```typescript
// app/api/blackout-dates/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The RLS policy already scopes this to the caller's own rows; the
  // explicit .eq("user_id", ...) below is defense-in-depth, matching
  // this codebase's usual style (e.g. DELETE /api/gigs/[id]) rather
  // than relying on RLS alone.
  const { error } = await supabase
    .from("artist_blackout_dates")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint app/api/blackout-dates/`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/blackout-dates/
git commit -m "feat: add blackout dates CRUD API"
```

---

### Task 7: Fetch blackout dates on the Calendar page

**Files:**
- Modify: `app/(protected)/calendar/page.tsx`

**Interfaces:**
- Consumes: `artist_blackout_dates` table (Task 1), `BlackoutDate` type (Task 2).
- Produces: `initialBlackoutDates: BlackoutDate[]` prop passed to `CalendarView`, consumed by Task 8.

- [ ] **Step 1: Add the fetch and pass the prop**

Find:
```typescript
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CalendarView from "@/components/calendar/CalendarView";
import BookingRequestsSection from "@/components/calendar/BookingRequestsSection";
```
Replace with:
```typescript
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CalendarView from "@/components/calendar/CalendarView";
import BookingRequestsSection from "@/components/calendar/BookingRequestsSection";
import { BlackoutDate } from "@/types";
```

Find:
```typescript
  const { data: gigs } = await supabase
    .from("gigs")
    .select("id, date, start_time, end_time, notes, status, venues(id, name, city, address)")
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .order("date", { ascending: true });
```
Replace with:
```typescript
  const { data: gigs } = await supabase
    .from("gigs")
    .select("id, date, start_time, end_time, notes, status, venues(id, name, city, address)")
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .order("date", { ascending: true });

  // artist_blackout_dates has a real owner-only RLS policy (unlike
  // most tables added this session) — the ordinary RLS-scoped
  // `supabase` client above is exactly right here, no service-role
  // client needed.
  const { data: blackoutDates } = await supabase
    .from("artist_blackout_dates")
    .select("id, start_date, end_date, note")
    .eq("user_id", user.id)
    .order("start_date", { ascending: true });
```

Find:
```typescript
      <div className="max-w-5xl">
        <CalendarView bookedVenues={bookedVenues} subscriptionUrl={subscriptionUrl} />
      </div>
```
Replace with:
```typescript
      <div className="max-w-5xl">
        <CalendarView
          bookedVenues={bookedVenues}
          subscriptionUrl={subscriptionUrl}
          initialBlackoutDates={(blackoutDates as BlackoutDate[]) ?? []}
        />
      </div>
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: one new error, in `components/calendar/CalendarView.tsx`, because it doesn't yet accept an `initialBlackoutDates` prop. That's expected — Task 8 fixes it. Confirm no other errors appear.

- [ ] **Step 3: Commit**

```bash
git add "app/(protected)/calendar/page.tsx"
git commit -m "feat: fetch artist blackout dates on the calendar page"
```

---

### Task 8: Blocked Dates UI on the Booking Calendar

**Files:**
- Modify: `components/calendar/CalendarView.tsx`

**Interfaces:**
- Consumes: `initialBlackoutDates: BlackoutDate[]` prop (Task 7), `BlackoutDate` type (Task 2), `GET`/`POST /api/blackout-dates` and `DELETE /api/blackout-dates/[id]` (Task 6).

This is a full-file replacement — the change touches state, a new section, and the grid rendering throughout, so a set of small find/replace edits would be harder to get right than rewriting the file once.

- [ ] **Step 1: Replace the whole file**

```typescript
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
import Link from "next/link";
import { BlackoutDate } from "@/types";

type Venue = {
  id: string;
  gig_id?: string;
  name: string;
  city: string | null;
  address: string | null;
  follow_up_date: string | null;
  gig_time: string | null;
  gig_end_time?: string | null;
  notes: string | null;
};

function downloadICS(venue: Venue) {
  const d = venue.follow_up_date!;
  const [y, m, day] = d.split("-");
  const pad = (n: string) => n.padStart(2, "0");
  const startH = venue.gig_time ? parseInt(venue.gig_time.split(":")[0]) : 19;
  const startM = venue.gig_time ? parseInt(venue.gig_time.split(":")[1]) : 0;
  const endH = startH + 3;
  const dtStart = `${y}${pad(m)}${pad(day)}T${String(startH).padStart(2,"0")}${String(startM).padStart(2,"0")}00`;
  const dtEnd   = `${y}${pad(m)}${pad(day)}T${String(endH).padStart(2,"0")}${String(startM).padStart(2,"0")}00`;
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z/, "Z");
  const escape = (s: string) => s.replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StageReach//StageReach//EN",
    "BEGIN:VEVENT",
    `UID:gigflow-${venue.id}@gigflow.app`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=America/Los_Angeles:${dtStart}`,
    `DTEND;TZID=America/Los_Angeles:${dtEnd}`,
    `SUMMARY:${escape(`Gig at ${venue.name}`)}`,
    `LOCATION:${escape(venue.address ?? venue.city ?? venue.name)}`,
    `DESCRIPTION:${escape(venue.notes ?? `Booked gig at ${venue.name}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${venue.name.replace(/[^a-z0-9]/gi, "_")}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// "Sep 12, 2026" for a single day, "Sep 12 – Sep 19, 2026" for a range.
function fmtRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + "T12:00:00");
  if (startDate === endDate) {
    return format(start, "EEEE, MMMM d, yyyy");
  }
  const end = new Date(endDate + "T12:00:00");
  return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
}

export default function CalendarView({
  bookedVenues,
  subscriptionUrl,
  initialBlackoutDates,
}: {
  bookedVenues: Venue[];
  subscriptionUrl: string;
  initialBlackoutDates: BlackoutDate[];
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [copied, setCopied] = useState(false);

  const [blackoutDates, setBlackoutDates] = useState<BlackoutDate[]>(initialBlackoutDates);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockNote, setBlockNote] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState("");
  const [blockWarning, setBlockWarning] = useState<string | null>(null);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const venuesWithDate = bookedVenues.filter((v) => v.follow_up_date);
  const venuesWithoutDate = bookedVenues.filter((v) => !v.follow_up_date);

  function venuesOnDay(day: Date) {
    return venuesWithDate.filter((v) =>
      isSameDay(new Date(v.follow_up_date + "T12:00:00"), day)
    );
  }

  // Plain string comparison of YYYY-MM-DD values — sidesteps every
  // timezone footgun that comparing Date objects across a day boundary
  // could introduce.
  function isDateBlocked(day: Date): boolean {
    const dayStr = format(day, "yyyy-MM-dd");
    return blackoutDates.some((b) => dayStr >= b.start_date && dayStr <= b.end_date);
  }

  function copyUrl() {
    navigator.clipboard.writeText(subscriptionUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function addBlackoutDate() {
    if (!blockStart || !blockEnd) return;
    if (blockEnd < blockStart) {
      setBlockError("End date must be on or after the start date.");
      return;
    }
    setBlocking(true);
    setBlockError("");
    const res = await fetch("/api/blackout-dates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: blockStart, end_date: blockEnd, note: blockNote || null }),
    });
    const data = await res.json();
    if (res.ok) {
      setBlackoutDates((prev) =>
        [...prev, data as BlackoutDate].sort((a, b) => a.start_date.localeCompare(b.start_date))
      );
      setBlockStart(""); setBlockEnd(""); setBlockNote("");
      setShowBlockForm(false);
      if (data.warning) setBlockWarning(data.warning as string);
    } else {
      setBlockError(data.error ?? "Couldn't block those dates — please try again.");
    }
    setBlocking(false);
  }

  async function removeBlackoutDate(id: string) {
    const res = await fetch(`/api/blackout-dates/${id}`, { method: "DELETE" });
    if (res.ok) setBlackoutDates((prev) => prev.filter((b) => b.id !== id));
  }

  const inputStyle = {
    background: "#262b33",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#F4E8D2",
    borderRadius: "8px",
    padding: "6px 10px",
    fontSize: "13px",
    outline: "none",
  };

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
          const dayVenues = venuesOnDay(day);
          const blocked = isDateBlocked(day);

          return (
            <div
              key={idx}
              className="min-h-[90px] p-2"
              title={blocked ? "Blocked off" : undefined}
              style={{
                backgroundColor: isCurrentMonth ? "#16181c" : "#13141700",
                backgroundImage: blocked
                  ? "repeating-linear-gradient(45deg, rgba(94,92,88,0.18), rgba(94,92,88,0.18) 4px, transparent 4px, transparent 10px)"
                  : "none",
                borderRight: (idx + 1) % 7 === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                borderBottom: idx < days.length - 7 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              <div
                className="text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full"
                style={{
                  color: isToday ? "#0E0E10" : isCurrentMonth ? "#9a9591" : "#2e2c28",
                  backgroundColor: isToday ? "#D4A64F" : "transparent",
                  fontWeight: isToday ? 700 : 400,
                }}
              >
                {format(day, "d")}
              </div>
              {dayVenues.map((v) => (
                <Link
                  key={v.id}
                  href={`/venues/${v.id}`}
                  className="block text-xs px-1.5 py-0.5 rounded mb-1 truncate"
                  style={{
                    backgroundColor: "rgba(76,175,125,0.2)",
                    color: "#4caf7d",
                    fontSize: "10px",
                  }}
                >
                  {v.name}
                </Link>
              ))}
              {blocked && dayVenues.length === 0 && (
                <span
                  className="block text-xs px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: "rgba(94,92,88,0.3)", color: "#9a9591", fontSize: "10px" }}
                >
                  Blocked
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Blocked Dates */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#9a9591" }}>
            Blocked Dates
          </h3>
          <button
            onClick={() => setShowBlockForm(!showBlockForm)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:brightness-110"
            style={{ background: "#D4A64F", color: "#0E0E10" }}
          >
            + Block Dates
          </button>
        </div>

        {blockWarning && (
          <div
            className="rounded-lg px-4 py-3 mb-4 flex items-start justify-between gap-3"
            style={{ backgroundColor: "rgba(212,166,79,0.1)", border: "1px solid rgba(212,166,79,0.25)" }}
          >
            <p className="text-xs" style={{ color: "#D4A64F" }}>{blockWarning}</p>
            <button
              onClick={() => setBlockWarning(null)}
              className="text-xs shrink-0"
              style={{ color: "#9a9591" }}
            >
              Dismiss
            </button>
          </div>
        )}

        {showBlockForm && (
          <div className="rounded-lg p-4 mb-4 space-y-3" style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Start Date *</label>
                <input type="date" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>End Date *</label>
                <input type="date" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
              </div>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Note (private — only you see this)</label>
              <input type="text" value={blockNote} onChange={(e) => setBlockNote(e.target.value)} placeholder="Family event, time off…" style={{ ...inputStyle, width: "100%" }} />
            </div>
            {blockError && <p className="text-xs" style={{ color: "#e25c5c" }}>{blockError}</p>}
            <div className="flex gap-2">
              <button
                onClick={addBlackoutDate}
                disabled={!blockStart || !blockEnd || blocking}
                className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                style={{ background: "#D4A64F", color: "#0E0E10" }}
              >
                {blocking ? "Saving…" : "Block Dates"}
              </button>
              <button
                onClick={() => setShowBlockForm(false)}
                className="text-xs px-4 py-1.5 rounded-lg"
                style={{ color: "#9a9591" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          {blackoutDates.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm" style={{ color: "#5e5c58" }}>
                No blocked dates. Use &quot;+ Block Dates&quot; to mark yourself unavailable.
              </p>
            </div>
          ) : (
            blackoutDates.map((b, idx) => {
              const isLast = idx === blackoutDates.length - 1;
              return (
                <div
                  key={b.id}
                  className="flex items-center gap-4 px-5 py-4"
                  style={{
                    backgroundColor: "#16181c",
                    borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                    borderLeft: "3px solid #5e5c58",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: "#F4E8D2" }}>
                      {fmtRange(b.start_date, b.end_date)}
                    </p>
                    {b.note && (
                      <p className="text-xs mt-0.5" style={{ color: "#9a9591" }}>{b.note}</p>
                    )}
                  </div>
                  <button
                    onClick={() => removeBlackoutDate(b.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0"
                    style={{ backgroundColor: "rgba(226,92,92,0.1)", color: "#e25c5c", border: "1px solid rgba(226,92,92,0.25)" }}
                  >
                    Remove
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Booked gigs list */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: "#9a9591" }}>
          All Booked Gigs
        </h3>
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.07)" }}
        >
          {bookedVenues.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm" style={{ color: "#5e5c58" }}>
                No booked gigs yet. Move a venue to &quot;Booked&quot; in your pipeline.
              </p>
            </div>
          ) : (
            bookedVenues.map((venue, idx) => {
              const isLast = idx === bookedVenues.length - 1;
              return (
                <div
                  key={`${venue.id}-${idx}`}
                  className="flex items-center gap-4 px-5 py-4"
                  style={{
                    backgroundColor: "#16181c",
                    borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                    borderLeft: "3px solid #4caf7d",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <Link href={`/venues/${venue.id}`}>
                      <p className="text-sm font-medium truncate" style={{ color: "#F4E8D2" }}>
                        {venue.name}
                      </p>
                    </Link>
                    <p className="text-xs" style={{ color: "#9a9591" }}>
                      {venue.follow_up_date
                        ? format(new Date(venue.follow_up_date + "T12:00:00"), "EEEE, MMMM d, yyyy")
                        : "No date set — add a Gig Date in the venue detail"}
                      {venue.city ? ` · ${venue.city}` : ""}
                    </p>
                  </div>
                  {venue.follow_up_date && (
                    <button
                      onClick={() => downloadICS(venue)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0"
                      style={{
                        backgroundColor: "rgba(255,255,255,0.05)",
                        color: "#9a9591",
                        border: "1px solid rgba(255,255,255,0.1)",
                      }}
                    >
                      Add to Calendar
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
        {venuesWithoutDate.length > 0 && (
          <p className="text-xs mt-3" style={{ color: "#5e5c58" }}>
            {venuesWithoutDate.length} booked venue{venuesWithoutDate.length > 1 ? "s" : ""} without a date — open the venue and set a Gig Date to show it on the calendar.
          </p>
        )}
      </div>

      {/* Subscription URL copy box */}
      <div className="mt-8 rounded-xl px-5 py-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>
          Calendar Subscription URL
        </p>
        <p className="text-xs mb-3" style={{ color: "#9a9591" }}>
          On iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar → paste this URL.
        </p>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 text-xs px-3 py-2 rounded-lg truncate"
            style={{ backgroundColor: "#0E0E10", color: "#9b7fe8", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            {subscriptionUrl}
          </code>
          <button
            onClick={copyUrl}
            className="px-3 py-2 rounded-lg text-xs font-medium transition-all shrink-0"
            style={{
              backgroundColor: copied ? "rgba(76,175,125,0.15)" : "rgba(255,255,255,0.07)",
              color: copied ? "#4caf7d" : "#9a9591",
              border: `1px solid ${copied ? "#4caf7d" : "rgba(255,255,255,0.1)"}`,
            }}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Note the `monthStart`/`monthEnd` variables are computed but only feed `calStart`/`calEnd` — this matches the file's pre-existing structure exactly (they were unused as standalone values before this change too; don't "clean this up," it's out of scope and not something this task introduced).

- [ ] **Step 2: Verify it compiles clean**

Run: `npx tsc --noEmit`
Expected: **no errors at all** — this was the last file with the pre-existing error from Task 7, so the project should be fully clean now.

Run: `npx eslint components/calendar/CalendarView.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/calendar/CalendarView.tsx
git commit -m "feat: add blocked dates section and grid markers to the booking calendar"
```

---

### Task 9: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a `artist_blackout_dates` bullet to CLAUDE.md's Core Data Model list**

Read the current Core Data Model section (the bulleted list starting with `- Zone —`) and insert a new bullet after the `booking_requests` line, matching its style:

> - artist_blackout_dates — a date range an artist has marked themselves unavailable for (start_date, end_date, an optional private note only the artist ever sees). Unlike most tables added this session, it has a normal client-facing RLS policy (owner-only) rather than "no policies, service-role only," since every row is owned and written by exactly one party. Feeds into the same availability check a venue's booking request already goes through — see `lib/bookings/availability.ts`.

- [ ] **Step 2: Add a paragraph to CLAUDE.md's Key Flows section**

Insert a new paragraph after the existing "Booking Requests" paragraph (the one ending "...since that's the venue's call to make. `NotificationType` gained `booking_rescheduled` for this..."):

> Blackout Dates — an artist can mark date ranges as unavailable from their own Booking Calendar (`/calendar`, a "+ Block Dates" button opening a small form: start date, end date, optional private note), managed via `GET`/`POST /api/blackout-dates` and `DELETE /api/blackout-dates/[id]`. A blocked date is treated exactly like an already-booked date from a venue's perspective: `GET /api/public/artists/[id]/availability` (used by the "Request to Book" date picker on an artist's public profile) and `POST /api/venue/booking-requests` (the actual submission) both now go through a shared `lib/bookings/availability.ts` — `getUnavailableDates` for the full list the date picker disables, `isDateUnavailable` for a real server-side rejection on submission. That server-side check was missing entirely before this feature; a venue could previously request a date the artist already had a confirmed gig on, with only a client-side disabled button in the way. Blocking a range never touches an existing gig or booking request — if one already exists in the blocked range, the artist just gets a non-blocking warning when they create it.

- [ ] **Step 3: Add a CHANGELOG.md entry**

Read `CHANGELOG.md`'s current top entry first to match its formatting exactly (this project keeps same-day entries grouped under one dated header with a short parenthetical topic, e.g. `## 2026-08-25 (booking reschedule & pipeline fixes)`), then add a new dated section for today:

```
## 2026-09-01 (artist blackout dates)
- [Feature] Artists can now block off date ranges on their Booking Calendar — for private events, time off, or anything else — so venues can't request a booking on those dates. Add an optional private note only you can see.
- [Fix] Closed a real gap: a venue's booking request for a date you're already booked on wasn't actually blocked by the app itself before — only a greyed-out button stopped them. Now it's enforced properly, for both existing gigs and new blocked dates.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document artist blackout dates"
```

---

### Task 10: Full verification and manual test

**Files:** none (verification only)

- [ ] **Step 1: Full project build**

Run: `npm run build`
Expected: builds successfully with no errors.

- [ ] **Step 2: Lint**

Run: `npx eslint .`
Expected: no new errors compared to `main`'s pre-existing baseline (this project has a small number of known pre-existing lint errors unrelated to this feature, e.g. `@typescript-eslint/no-explicit-any` in `components/venue/GigsSection.tsx` — don't chase those, just confirm nothing new appears in files this plan touched).

- [ ] **Step 3: Live manual test, if a real artist test account is available**

Taylor has a real artist login (used throughout this session) and a real venue test account. Walk through:

1. As the artist: go to `/calendar`, click "+ Block Dates," pick a start and end date a few days out, add a note, save. Confirm the range appears in the "Blocked Dates" list with the note, and the grid shows the diagonal-hash marker on those days.
2. As the venue: open that artist's public profile, click "Request to Book," and confirm none of the blocked days can be selected in the date picker.
3. Directly test the server-side fix: with the venue logged in, use the browser's dev tools (or any HTTP client) to `POST /api/venue/booking-requests` with a blocked date in the body, bypassing the UI entirely. Confirm it's rejected with a 400 and the message "This artist isn't available on that date." Repeat for a date that has an existing confirmed gig (not just a blackout range) to confirm that part of the fix too.
4. As the artist: create a new booking request from the venue side for an open date, accept it, then try to block a range that includes that date. Confirm the range is created, a warning banner appears mentioning the existing booking, and the booking request itself is untouched (still visible, still accepted).
5. As the artist: click "Remove" on a blocked range. Confirm it disappears from the list and the grid, and re-check as the venue that the date is selectable again.

- [ ] **Step 4: If a live test isn't practical in this environment**

Fall back to static verification only: confirm the build is clean (Steps 1–2 above), and manually re-trace both `isDateUnavailable` call sites (`app/api/venue/booking-requests/route.ts` and, indirectly, `getUnavailableDates` in the availability route) against the exact SQL each one runs, to catch anything a live click-through would have caught. Report clearly to Taylor that full live end-to-end testing (across both an artist and a venue account, in real time) still needs to happen after this ships — this is the fallback, not a substitute for it being done at some point.

- [ ] **Step 5: Report the migration to Taylor**

Whichever path was taken above, remind Taylor that `supabase/migrations/025_artist_blackout_dates.sql` still needs to be run manually in the Supabase SQL Editor before any of this works in production — same as every other migration this session, since there's no direct database access from this environment.
