# Booking Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a venue send a date/time booking request to any artist's public profile; the artist accepts or declines; accepting produces a real Gig that plugs into the existing Booking Calendar, prep checklist, and mutual-ratings flows unchanged.

**Architecture:** A new `booking_requests` table (RLS enabled, no client-facing policies — same pattern as `venue_artist_ratings`) tracks each request's own pending/accepted/declined lifecycle. Accepting a request runs a shared helper that finds-or-creates the artist's pipeline `venues` row for that venue (reusing the existing "find or create a default zone" pattern), creates a real `Gig` on it, and links the request to that gig. Two system emails (new-request, response) mirror the existing ratings-notification pattern exactly.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), Resend (email), TypeScript. No automated test suite exists — verification is `npx tsc --noEmit`, `npx eslint`, migration application via the Supabase SQL Editor, and manual/live checks.

**Spec:** `docs/superpowers/specs/2026-08-20-booking-requests-design.md` — read this first for full rationale. This plan implements it task-by-task.

---

## Before you start

**One deliberate adaptation from the spec's exact wording, flagged here so it isn't mistaken for an oversight:** the spec says the request form's date picker "greys out" unavailable dates. A native HTML `<input type="date">` — used throughout this codebase for date fields (see `components/venue/GigsSection.tsx`) — cannot visually grey out individual dates inside its picker; no browser exposes that styling hook. This plan achieves the same *practical* goal (never let a venue submit a request for a date that's already taken) a different way: the form fetches the artist's unavailable dates on load, shows a clear inline warning the moment an unavailable date is picked, and disables the Submit button while one is selected. Building a fully custom calendar-grid widget to get literal per-date greying would be a much larger, novel piece of UI (nothing like it exists yet in this codebase) — worth a dedicated visual-design pass of its own if ever wanted, not something to improvise mid-plan. Flag this trade-off to Taylor after the feature ships; don't silently build a custom calendar widget instead without checking with her first.

---

## Task 1: Migration — `booking_requests`

**Files:**
- Create: `supabase/migrations/019_booking_requests.sql`

- [ ] **Step 1: Confirm the migration number is actually free**

This project's `supabase/migrations/` folder is not fully authoritative for the live schema (documented drift: `gigs.checklist` has no migration file at all, applied directly in Supabase at some point). Before creating this file:

Run: `ls supabase/migrations/ | sort`
Expected: highest existing file is `018_venue_artist_ratings.sql`, confirming `019` is next by local convention.

There's no formal migration-tracking table in this project (migrations are applied manually via the Supabase SQL Editor, not a CLI migration runner) — the number itself has no runtime significance, it's just a file-ordering convention. The one thing that actually matters is that `booking_requests` doesn't already exist as a table. If you have Supabase credentials available in this environment (check for a `.env.local` with `SUPABASE_SERVICE_ROLE_KEY`), you can confirm directly:

```bash
source .env.local 2>/dev/null
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/booking_requests?select=id&limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

Expected: an error mentioning the relation doesn't exist (confirms it's genuinely new) — NOT a `[]` or real data (which would mean this table somehow already exists and you must stop and report BLOCKED). If no `.env.local` is present in this environment, skip this check and proceed — the local filename sequence is a reasonable fallback.

- [ ] **Step 2: Write the migration**

```sql
-- ============================================================
-- BOOKING REQUESTS
-- A venue proposes a date/time to an artist; the artist accepts
-- or declines. Tracks its own lifecycle independently of the
-- artist's Gig calendar until accepted, at which point a real
-- Gig is created and linked back via gig_id.
--
-- No client-facing RLS policies — same reasoning as
-- venue_artist_ratings (018): Postgres RLS restricts which ROWS
-- a policy allows, not which COLUMNS within an allowed row, so a
-- policy letting an artist "update their own requests" couldn't
-- stop them from also rewriting the venue's original date or
-- message. "Artist's response endpoint can only ever change
-- status" is enforced in application code instead. Every
-- read/write goes through a server route using the service-role
-- client.
-- ============================================================

create table public.booking_requests (
  id                uuid primary key default gen_random_uuid(),
  venue_profile_id  uuid not null references public.venue_profiles(id) on delete cascade,
  artist_user_id    uuid not null references public.profiles(id) on delete cascade,

  date              date not null,
  start_time        text,   -- HH:MM, matches gigs.start_time's format
  end_time          text,   -- HH:MM
  message           text,

  status            text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  gig_id            uuid references public.gigs(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_booking_requests_artist_user_id on public.booking_requests(artist_user_id);
create index idx_booking_requests_venue_profile_id on public.booking_requests(venue_profile_id);

create trigger booking_requests_updated_at
  before update on public.booking_requests
  for each row execute function update_updated_at();

alter table public.booking_requests enable row level security;
-- Deliberately no policies — see header comment above.
```

- [ ] **Step 3: Verify `update_updated_at()` exists**

Run: `grep -rn "create.*function update_updated_at" supabase/migrations/`
Expected: at least one match (defined in `001_initial_schema.sql`, reused by `016_venue_profiles.sql` and `018_venue_artist_ratings.sql`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/019_booking_requests.sql
git commit -m "feat: add booking_requests table"
```

---

## Task 2: Types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the new types**

Add near the bottom of `types/index.ts`, after the existing `PublicRatingsResponse` interface:

```typescript
// ============================================================
// BOOKING REQUESTS
// ============================================================

export type BookingRequestStatus = "pending" | "accepted" | "declined";

// The raw shape of a booking_requests row as stored — server-side only.
export interface BookingRequestRow {
  id: string;
  venue_profile_id: string;
  artist_user_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  message: string | null;
  status: BookingRequestStatus;
  gig_id: string | null;
  created_at: string;
  updated_at: string;
}

// What the artist's pending-list endpoint returns per request.
export interface PendingBookingRequest {
  id: string;
  venue_name: string;
  venue_photo_url: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  message: string | null;
}

// What the venue's sent-requests endpoint returns per request.
export interface VenueBookingRequestView {
  id: string;
  artist_name: string;
  artist_photo_url: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  message: string | null;
  status: BookingRequestStatus;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add booking request types"
```

---

## Task 3: Shared pipeline-linking helper

**Files:**
- Create: `lib/bookings/pipeline.ts`

This is the module Task 7 (the accept handler) depends on. Keeping it separate makes the "find or create a pipeline venue" logic independently readable and testable.

- [ ] **Step 1: Write the helper**

```typescript
// lib/bookings/pipeline.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMatchKey } from "@/lib/venues/matching";

export type EnsureLinkedBookedVenueResult =
  | { venueId: string }
  | { error: string };

// Finds or creates the artist's pipeline `venues` row for this venue
// account, and sets its stage to "booked" — whether it was just created
// or already existed unlinked — since a confirmed Gig is being placed on
// it in the same operation regardless of whatever stage it was
// previously at (e.g. "contacted" or "negotiating"). This overwrite is
// intentional: a real accepted booking is the strongest possible
// pipeline signal.
export async function ensureLinkedBookedVenue(
  service: SupabaseClient,
  opts: { artistUserId: string; venueProfileId: string }
): Promise<EnsureLinkedBookedVenueResult> {
  // 1. Already linked to this exact venue account?
  const { data: linked, error: linkedError } = await service
    .from("venues")
    .select("id")
    .eq("user_id", opts.artistUserId)
    .eq("venue_profile_id", opts.venueProfileId)
    .maybeSingle();
  if (linkedError) return { error: linkedError.message };

  if (linked) {
    const { error: updateError } = await service
      .from("venues")
      .update({ stage: "booked" })
      .eq("id", linked.id);
    if (updateError) return { error: updateError.message };
    return { venueId: linked.id as string };
  }

  // 2. Load the venue account's real info to match/create against.
  const { data: venueProfile, error: profileError } = await service
    .from("venue_profiles")
    .select("venue_name, city, venue_type, address, contact_email, contact_phone")
    .eq("id", opts.venueProfileId)
    .single();
  if (profileError || !venueProfile) return { error: "Venue profile not found" };

  // 3. Existing pipeline row matching by name+city, just not yet linked?
  const { data: candidates, error: candidatesError } = await service
    .from("venues")
    .select("id, name, city")
    .eq("user_id", opts.artistUserId)
    .is("venue_profile_id", null);
  if (candidatesError) return { error: candidatesError.message };

  const targetKey = normalizeMatchKey(venueProfile.venue_name as string, venueProfile.city as string | null);
  const match = (candidates ?? []).find(
    (c) => normalizeMatchKey(c.name as string, c.city as string | null) === targetKey
  );

  if (match) {
    const { error: linkError } = await service
      .from("venues")
      .update({ venue_profile_id: opts.venueProfileId, stage: "booked" })
      .eq("id", match.id);
    if (linkError) return { error: linkError.message };
    return { venueId: match.id as string };
  }

  // 4. No match at all — find or create a default zone for this artist,
  // same pattern as POST /api/venues (Discover Venues' "add to pipeline"
  // flow), since a venue arriving via a booking request has no "search
  // zone" context the way one found via Discover Venues does.
  let { data: zone } = await service
    .from("zones")
    .select("id")
    .eq("user_id", opts.artistUserId)
    .limit(1)
    .single();

  if (!zone) {
    const { data: newZone, error: zoneError } = await service
      .from("zones")
      .insert({ user_id: opts.artistUserId, name: "Default", zip_code: null, radius_mi: 50 })
      .select("id")
      .single();
    if (zoneError || !newZone) return { error: "Failed to create a default zone" };
    zone = newZone;
  }

  // 5. Create the new pipeline row, filled in from the venue's real account.
  const { data: created, error: createError } = await service
    .from("venues")
    .insert({
      zone_id: zone!.id,
      user_id: opts.artistUserId,
      name: venueProfile.venue_name as string,
      type: (venueProfile.venue_type as string | null) ?? null,
      city: (venueProfile.city as string | null) ?? null,
      address: (venueProfile.address as string | null) ?? null,
      website: null,
      contact_name: null,
      contact_email: (venueProfile.contact_email as string | null) ?? null,
      contact_phone: (venueProfile.contact_phone as string | null) ?? null,
      stage: "booked",
      confidence: "MEDIUM",
      notes: null,
      venue_profile_id: opts.venueProfileId,
    })
    .select("id")
    .single();
  if (createError || !created) return { error: createError?.message ?? "Failed to create pipeline venue" };

  return { venueId: created.id as string };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/bookings/pipeline.ts
git commit -m "feat: add booking-accept pipeline linking helper"
```

---

## Task 4: Email notification helper

**Files:**
- Create: `lib/email/booking-request-notifications.ts`

Mirrors `lib/email/rating-notifications.ts` exactly — same shared-sender pattern, same `profiles.email` lookups, same error-logging-on-every-query discipline (that discipline was a real fix applied to the ratings version after its own code review; building it in correctly here from the start).

- [ ] **Step 1: Write the helper**

```typescript
// lib/email/booking-request-notifications.ts
import { Resend } from "resend";
import { SupabaseClient } from "@supabase/supabase-js";

async function sendSystemEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail) {
    console.error("booking-request-notifications: Resend not configured (missing API key or from address)");
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `StageReach <${fromEmail}>`,
    to,
    subject,
    text,
  });
  if (error) console.error("booking-request-notifications: send failed", error);
}

// Fired from POST /api/venue/booking-requests right after a request is created.
export async function sendNewBookingRequestEmail(
  service: SupabaseClient,
  request: { artist_user_id: string; venue_profile_id: string; date: string }
): Promise<void> {
  const { data: artistLogin, error: artistError } = await service
    .from("profiles")
    .select("email")
    .eq("id", request.artist_user_id)
    .maybeSingle();
  if (artistError) console.error("sendNewBookingRequestEmail: artist profile lookup failed", artistError);
  if (!artistLogin?.email) return;

  const { data: venueProfile, error: venueError } = await service
    .from("venue_profiles")
    .select("venue_name")
    .eq("id", request.venue_profile_id)
    .maybeSingle();
  if (venueError) console.error("sendNewBookingRequestEmail: venue profile lookup failed", venueError);

  const venueName = (venueProfile?.venue_name as string | null) ?? "A venue";

  await sendSystemEmail(
    artistLogin.email as string,
    "You have a new booking request on StageReach",
    `${venueName} requested to book you for ${request.date}. Head to your Booking Calendar on StageReach to accept or decline.`
  );
}

// Fired from PATCH /api/booking-requests/[id] right after the artist responds.
export async function sendBookingResponseEmail(
  service: SupabaseClient,
  request: { venue_profile_id: string; artist_user_id: string; date: string },
  status: "accepted" | "declined"
): Promise<void> {
  const { data: venueProfile, error: venueError } = await service
    .from("venue_profiles")
    .select("user_id, venue_name")
    .eq("id", request.venue_profile_id)
    .maybeSingle();
  if (venueError) console.error("sendBookingResponseEmail: venue profile lookup failed", venueError);
  if (!venueProfile?.user_id) return;

  const { data: venueLogin, error: loginError } = await service
    .from("profiles")
    .select("email")
    .eq("id", venueProfile.user_id as string)
    .maybeSingle();
  if (loginError) console.error("sendBookingResponseEmail: venue login lookup failed", loginError);
  if (!venueLogin?.email) return;

  const { data: artistProfile, error: artistError } = await service
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", request.artist_user_id)
    .maybeSingle();
  if (artistError) console.error("sendBookingResponseEmail: artist profile lookup failed", artistError);

  const artistName = (artistProfile?.display_name as string | null) ?? "The artist";

  if (status === "accepted") {
    await sendSystemEmail(
      venueLogin.email as string,
      "Your booking request was accepted",
      `${artistName} accepted your booking request for ${request.date}. It's on the calendar!`
    );
  } else {
    await sendSystemEmail(
      venueLogin.email as string,
      "Your booking request was declined",
      `${artistName} declined your booking request for ${request.date}.`
    );
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/email/booking-request-notifications.ts
git commit -m "feat: add booking request notification email helpers"
```

---

## Task 5: Public availability endpoint

**Files:**
- Create: `app/api/public/artists/[id]/availability/route.ts`

No login required — powers the request form's date validation. Must return ONLY a bare array of dates, mirroring the data-minimization already established by the public ratings routes (no venue names, no other gig details).

- [ ] **Step 1: Write the route**

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

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/public/artists/\[id\]/availability/route.ts
git commit -m "feat: add public artist availability endpoint"
```

---

## Task 6: Venue-side API routes

**Files:**
- Create: `app/api/venue/booking-requests/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/venue/booking-requests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { sendNewBookingRequestEmail } from "@/lib/email/booking-request-notifications";

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

// Every request this venue has sent, with current status.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const venueProfile = await getOwnCompletedVenueProfile(supabase, user.id);
  if (!venueProfile) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const service = await createServiceClient();
  const { data: rows, error } = await service
    .from("booking_requests")
    .select("*")
    .eq("venue_profile_id", venueProfile.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const artistIds = [...new Set((rows ?? []).map((r) => r.artist_user_id as string))];
  const { data: artists } = await service
    .from("artist_profiles")
    .select("user_id, display_name, photo_url")
    .in("user_id", artistIds.length > 0 ? artistIds : [""]);
  const artistByUserId = new Map((artists ?? []).map((a) => [a.user_id as string, a]));

  const requests = (rows ?? []).map((r) => {
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

  return NextResponse.json({ requests });
}

// Creates a new request. Requires a completed venue account.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const venueProfile = await getOwnCompletedVenueProfile(supabase, user.id);
  if (!venueProfile) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { artist_user_id, date, start_time, end_time, message } = body;

  if (!artist_user_id || !date) {
    return NextResponse.json({ error: "artist_user_id and date are required" }, { status: 400 });
  }

  const service = await createServiceClient();
  const { data: created, error } = await service
    .from("booking_requests")
    .insert({
      venue_profile_id: venueProfile.id,
      artist_user_id,
      date,
      start_time: start_time || null,
      end_time: end_time || null,
      message: message || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await sendNewBookingRequestEmail(service, created);
  } catch (err) {
    console.error("POST /api/venue/booking-requests: failed to send notification email", err);
  }

  return NextResponse.json(created);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/venue/booking-requests/
git commit -m "feat: add venue-side booking request API routes"
```

---

## Task 7: Artist-side API routes

**Files:**
- Create: `app/api/booking-requests/route.ts`
- Create: `app/api/booking-requests/[id]/route.ts`

This is the task that needs the most care in review — the accept path touches three tables (`booking_requests`, `venues`, `gigs`) and must correctly reject an already-resolved request.

- [ ] **Step 1: Write the pending-list route**

```typescript
// app/api/booking-requests/route.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Every PENDING request addressed to this artist.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const { data: rows, error } = await service
    .from("booking_requests")
    .select("*")
    .eq("artist_user_id", user.id)
    .eq("status", "pending")
    .order("date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const venueIds = [...new Set((rows ?? []).map((r) => r.venue_profile_id as string))];
  const { data: venues } = await service
    .from("venue_profiles")
    .select("id, venue_name, photo_url")
    .in("id", venueIds.length > 0 ? venueIds : [""]);
  const venueById = new Map((venues ?? []).map((v) => [v.id as string, v]));

  const pending = (rows ?? []).map((r) => {
    const venue = venueById.get(r.venue_profile_id as string);
    return {
      id: r.id,
      venue_name: (venue?.venue_name as string | null) ?? "A venue",
      venue_photo_url: (venue?.photo_url as string | null) ?? null,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      message: r.message,
    };
  });

  return NextResponse.json({ pending });
}
```

- [ ] **Step 2: Write the accept/decline route**

```typescript
// app/api/booking-requests/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureLinkedBookedVenue } from "@/lib/bookings/pipeline";
import { sendBookingResponseEmail } from "@/lib/email/booking-request-notifications";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { status } = body;
  if (status !== "accepted" && status !== "declined") {
    return NextResponse.json({ error: "status must be 'accepted' or 'declined'" }, { status: 400 });
  }

  const service = await createServiceClient();

  const { data: reqRow, error: fetchError } = await service
    .from("booking_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!reqRow) return NextResponse.json({ error: "Booking request not found" }, { status: 404 });
  if (reqRow.artist_user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Only act on a still-pending request — reject re-accepting or
  // re-declining one that's already been responded to.
  if (reqRow.status !== "pending") {
    return NextResponse.json({ error: "This request has already been responded to" }, { status: 409 });
  }

  if (status === "declined") {
    const { data: updated, error: updateError } = await service
      .from("booking_requests")
      .update({ status: "declined" })
      .eq("id", id)
      .select()
      .single();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    try {
      await sendBookingResponseEmail(service, updated, "declined");
    } catch (err) {
      console.error("PATCH /api/booking-requests: failed to send decline email", err);
    }
    return NextResponse.json(updated);
  }

  // status === "accepted"
  const linkResult = await ensureLinkedBookedVenue(service, {
    artistUserId: user.id,
    venueProfileId: reqRow.venue_profile_id,
  });
  if ("error" in linkResult) {
    return NextResponse.json({ error: linkResult.error }, { status: 500 });
  }

  const { data: gig, error: gigError } = await service
    .from("gigs")
    .insert({
      venue_id: linkResult.venueId,
      user_id: user.id,
      date: reqRow.date,
      start_time: reqRow.start_time,
      end_time: reqRow.end_time,
      notes: reqRow.message,
      status: "upcoming",
    })
    .select()
    .single();
  if (gigError) return NextResponse.json({ error: gigError.message }, { status: 500 });

  const { data: updated, error: updateError } = await service
    .from("booking_requests")
    .update({ status: "accepted", gig_id: gig.id })
    .eq("id", id)
    .select()
    .single();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  try {
    await sendBookingResponseEmail(service, updated, "accepted");
  } catch (err) {
    console.error("PATCH /api/booking-requests: failed to send accept email", err);
  }

  return NextResponse.json(updated);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/booking-requests/
git commit -m "feat: add artist-side booking request API routes"
```

---

## Task 8: Artist Sidebar — extend the pending-count badge

**Files:**
- Modify: `components/layout/Sidebar.tsx`

The `Sidebar` component already fetches `pendingRatingsCount` from `/api/ratings/pending` inside its mount `useEffect` and uses a per-link `badgeValue` computation to show it only on the `/ratings` link. This task adds the identical pattern for the Booking Calendar link (`/calendar`), fed by the new `GET /api/booking-requests`.

- [ ] **Step 1: Read the current file**

Run: `cat components/layout/Sidebar.tsx`
Confirms it still matches the version described below — in particular the exact `useEffect` block and the `badgeValue` line inside `mainLinks.map`.

- [ ] **Step 2: Add a second pending-count state**

Find this line:

```typescript
  const [pendingRatingsCount, setPendingRatingsCount] = useState(0);
```

Add immediately after it:

```typescript
  const [pendingBookingRequestsCount, setPendingBookingRequestsCount] = useState(0);
```

- [ ] **Step 3: Fetch it alongside the ratings count**

Find this block inside the mount `useEffect`:

```typescript
    fetch("/api/ratings/pending")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setPendingRatingsCount(data?.pending?.length ?? 0))
      .catch(() => {});
```

Add immediately after it (still inside the same `useEffect`, before the `window.addEventListener` line):

```typescript
    fetch("/api/booking-requests")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setPendingBookingRequestsCount(data?.pending?.length ?? 0))
      .catch(() => {});
```

- [ ] **Step 4: Extend the badge computation**

Find this line:

```typescript
            const badgeValue = link.href === "/ratings" ? (pendingRatingsCount > 0 ? pendingRatingsCount : null) : link.badge;
```

Replace it with:

```typescript
            const badgeValue =
              link.href === "/ratings" ? (pendingRatingsCount > 0 ? pendingRatingsCount : null) :
              link.href === "/calendar" ? (pendingBookingRequestsCount > 0 ? pendingBookingRequestsCount : null) :
              link.badge;
```

Leave everything else in the file (the badge-rendering JSX itself, all other links) exactly as-is — this task only adds the second count and extends the existing ternary chain.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add components/layout/Sidebar.tsx
git commit -m "feat: show pending-count badge on Booking Calendar nav link"
```

---

## Task 9: Booking Requests section on the Calendar page

**Files:**
- Create: `components/calendar/BookingRequestsSection.tsx`
- Modify: `app/(protected)/calendar/page.tsx`

- [ ] **Step 1: Read the current calendar page**

Run: `cat app/(protected)/calendar/page.tsx`
Confirms the current structure — a server component that auto-completes past-due gigs, fetches `gigs` joined with `venues`, builds a `bookedVenues` array, and renders a header + iCloud subscription banner + `<CalendarView>` inside a `max-w-5xl` wrapper.

- [ ] **Step 2: Write the new component**

```typescript
// components/calendar/BookingRequestsSection.tsx
"use client";

import { useState, useEffect } from "react";
import { PendingBookingRequest } from "@/types";

export default function BookingRequestsSection() {
  const [pending, setPending] = useState<PendingBookingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/booking-requests");
    const data = res.ok ? await res.json() : { pending: [] };
    setPending(data.pending ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function respond(id: string, status: "accepted" | "declined") {
    setRespondingId(id);
    const res = await fetch(`/api/booking-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setRespondingId(null);
    if (res.ok) load();
  }

  if (!loading && pending.length === 0) return null;

  return (
    <div className="mb-8 max-w-5xl">
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
        Booking Requests {pending.length > 0 && `(${pending.length})`}
      </h2>
      <div className="space-y-3">
        {pending.map((r) => (
          <div
            key={r.id}
            className="rounded-xl p-4 flex items-center gap-4"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            {r.venue_photo_url ? (
              <img src={r.venue_photo_url} alt={r.venue_name} className="w-10 h-10 rounded-full object-cover shrink-0" />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
              >
                {r.venue_name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>{r.venue_name}</div>
              <div className="text-xs" style={{ color: "#9a9591" }}>
                {r.date}{r.start_time ? ` · ${r.start_time}` : ""}{r.end_time ? `–${r.end_time}` : ""}
              </div>
              {r.message && (
                <div className="text-xs mt-1" style={{ color: "#5e5c58" }}>{r.message}</div>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => respond(r.id, "accepted")}
                disabled={respondingId === r.id}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
                style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: respondingId === r.id ? 0.6 : 1 }}
              >
                Accept
              </button>
              <button
                onClick={() => respond(r.id, "declined")}
                disabled={respondingId === r.id}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add it to the calendar page**

In `app/(protected)/calendar/page.tsx`, add an import near the top:

```typescript
import BookingRequestsSection from "@/components/calendar/BookingRequestsSection";
```

Find the header block:

```typescript
      {/* Header */}
      <div className="flex items-center justify-between mb-6 max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#F4E8D2" }}>
          Booking Calendar
        </h1>
      </div>
```

Insert `<BookingRequestsSection />` immediately after this block, before the iCloud subscription banner:

```typescript
      {/* Header */}
      <div className="flex items-center justify-between mb-6 max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#F4E8D2" }}>
          Booking Calendar
        </h1>
      </div>

      <BookingRequestsSection />

      {/* iCloud subscription banner */}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add components/calendar/BookingRequestsSection.tsx "app/(protected)/calendar/page.tsx"
git commit -m "feat: add Booking Requests section to the Calendar page"
```

---

## Task 10: Venue-side Bookings page

**Files:**
- Create: `app/venue/bookings/page.tsx`
- Modify: `components/venue/VenueNav.tsx`

**Reminder from the spec: this nav link gets NO pending-count badge.** Unlike Ratings (where both artist and venue sides have something actionable to respond to), a venue viewing their own sent-requests list has nothing to act on here — it's a status list, not an inbox. Do not add a badge to match the Ratings link's pattern; that asymmetry is intentional.

- [ ] **Step 1: Write the page**

```typescript
// app/venue/bookings/page.tsx
"use client";

import { useState, useEffect } from "react";
import VenueNav from "@/components/venue/VenueNav";
import { VenueBookingRequestView } from "@/types";

const STATUS_STYLE: Record<VenueBookingRequestView["status"], { bg: string; color: string; label: string }> = {
  pending: { bg: "rgba(212,166,79,0.15)", color: "#D4A64F", label: "Pending" },
  accepted: { bg: "rgba(76,175,125,0.15)", color: "#4caf7d", label: "Accepted" },
  declined: { bg: "rgba(226,92,92,0.15)", color: "#e25c5c", label: "Declined" },
};

export default function VenueBookingsPage() {
  const [requests, setRequests] = useState<VenueBookingRequestView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/venue/booking-requests")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
      <VenueNav />
      {!loading && (
        <div className="max-w-2xl mx-auto px-6 py-10">
          <h1 className="text-xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Bookings</h1>

          {requests.length === 0 ? (
            <p className="text-sm" style={{ color: "#5e5c58" }}>You haven&apos;t sent any booking requests yet.</p>
          ) : (
            <div className="space-y-3">
              {requests.map((r) => {
                const s = STATUS_STYLE[r.status];
                return (
                  <div
                    key={r.id}
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
                    </div>
                    <span
                      className="text-xs px-2.5 py-1 rounded-full shrink-0"
                      style={{ backgroundColor: s.bg, color: s.color }}
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the nav link, no badge**

In `components/venue/VenueNav.tsx`, update `links`:

```typescript
const links = [
  { href: "/venue/profile", label: "My Profile" },
  { href: "/venue/discover", label: "Discover Artists" },
  { href: "/venue/bookings", label: "Bookings" },
  { href: "/venue/ratings", label: "Ratings" },
];
```

No other change to this file — the existing `pendingRatingsCount` state and `badge` computation (`link.href === "/venue/ratings" && pendingRatingsCount > 0 ? pendingRatingsCount : null`) stay exactly as they are. `/venue/bookings` simply isn't checked by that ternary, so it never gets a badge.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/venue/bookings/ components/venue/VenueNav.tsx
git commit -m "feat: add venue bookings page and nav link"
```

---

## Task 11: Artist public profile — "Request to Book"

**Files:**
- Modify: `app/profile/[id]/page.tsx`
- Create: `components/booking/RequestToBookButton.tsx`

This is the other task that needs extra care — `app/profile/[id]/page.tsx` currently has **zero auth check** (it only ever uses `createServiceClient()`, since the page itself must render for logged-out visitors). This task adds an auth check WITHOUT breaking that — the page must still fully render for a logged-out visitor, just with `viewerType: "other"`.

- [ ] **Step 1: Read the current file**

Run: `cat "app/profile/[id]/page.tsx"`
Confirms the current imports, the exact "Book button" `<a href="mailto:...">` block to be replaced, and that `createClient` (the RLS-scoped client, distinct from `createServiceClient`) is not yet imported.

- [ ] **Step 2: Write the new client component**

```typescript
// components/booking/RequestToBookButton.tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "#F4E8D2",
};

export default function RequestToBookButton({
  artistUserId,
  viewerType,
}: {
  artistUserId: string;
  viewerType: "venue" | "other";
}) {
  const [open, setOpen] = useState(false);

  if (viewerType !== "venue") {
    return (
      <div
        className="rounded-lg py-2.5 px-3 text-center text-xs"
        style={{ backgroundColor: "#1e2128", color: "#9a9591" }}
      >
        Are you a venue?{" "}
        <Link href="/venues/signup" className="underline" style={{ color: "#D4A64F" }}>
          Sign up to request a booking
        </Link>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="block w-full text-center rounded-lg py-2.5 text-sm font-bold transition-all hover:brightness-110"
        style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
      >
        Request to Book
      </button>
      {open && <RequestBookingModal artistUserId={artistUserId} onClose={() => setOpen(false)} />}
    </>
  );
}

function RequestBookingModal({ artistUserId, onClose }: { artistUserId: string; onClose: () => void }) {
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set());
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`/api/public/artists/${artistUserId}/availability`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUnavailableDates(new Set(data?.dates ?? [])))
      .catch(() => {});
  }, [artistUserId]);

  const isUnavailable = !!date && unavailableDates.has(date);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || isUnavailable) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/venue/booking-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artist_user_id: artistUserId,
        date,
        start_time: startTime || undefined,
        end_time: endTime || undefined,
        message: message.trim() || undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSent(true);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't send the request — please try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-6 w-full max-w-sm"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {sent ? (
          <div className="text-center">
            <h2 className="text-lg font-bold mb-2" style={{ color: "#F4E8D2" }}>Request sent</h2>
            <p className="text-sm mb-4" style={{ color: "#9a9591" }}>
              You&apos;ll be notified once they respond. Track it anytime on your Bookings page.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="text-lg font-bold mb-1" style={{ color: "#F4E8D2" }}>Request to Book</h2>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "#9a9591" }}>Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={inputStyle}
              />
              {isUnavailable && (
                <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>
                  This date is already booked — try another.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "#9a9591" }}>Start time</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "#9a9591" }}>End time</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "#9a9591" }}>Note (optional)</label>
              <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
            </div>
            {error && <p className="text-xs" style={{ color: "#e25c5c" }}>{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={!date || saving || isUnavailable}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
                style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: (!date || saving || isUnavailable) ? 0.6 : 1 }}
              >
                {saving ? "Sending…" : "Send Request"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold"
                style={{ color: "#9a9591" }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the auth check and replace the mailto button**

In `app/profile/[id]/page.tsx`, update the imports at the top — change:

```typescript
import { createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { ArtistProfile, Package, VideoSample, SocialLinks } from "@/types";
import RatingsSection from "@/components/ratings/RatingsSection";
```

to:

```typescript
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { ArtistProfile, Package, VideoSample, SocialLinks } from "@/types";
import RatingsSection from "@/components/ratings/RatingsSection";
import RequestToBookButton from "@/components/booking/RequestToBookButton";
```

Find this block (right after fetching `profile`, before it's cast to `ArtistProfile`):

```typescript
  const { data: profile } = await supabase
    .from("artist_profiles")
    .select("*")
    .eq("user_id", id)
    .single();

  if (!profile) notFound();
```

Insert the viewer-identity check immediately after `if (!profile) notFound();`:

```typescript
  const { data: profile } = await supabase
    .from("artist_profiles")
    .select("*")
    .eq("user_id", id)
    .single();

  if (!profile) notFound();

  // Determine viewer type for the "Request to Book" control below. This
  // page is otherwise fully public (it only used createServiceClient()
  // before this) — adding an auth check here must not change that: a
  // logged-out visitor still renders the whole page normally, just with
  // viewerType "other".
  const authSupabase = await createClient();
  const { data: { user: viewer } } = await authSupabase.auth.getUser();
  let viewerType: "venue" | "other" = "other";
  if (viewer) {
    const { data: viewerVenueProfile } = await authSupabase
      .from("venue_profiles")
      .select("venue_name")
      .eq("user_id", viewer.id)
      .maybeSingle();
    if (viewerVenueProfile?.venue_name) viewerType = "venue";
  }
```

Find the existing "Book button":

```typescript
          {/* Book button */}
          <a
            href={`mailto:${p.contact_email || ""}?subject=Booking Inquiry — ${p.display_name || "Artist"}`}
            className="block w-full text-center rounded-lg py-2.5 text-sm font-bold transition-all hover:brightness-110"
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
          >
            Send Booking Inquiry
          </a>
```

Replace it with:

```typescript
          {/* Book button */}
          <RequestToBookButton artistUserId={id} viewerType={viewerType} />
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual visual check**

Run the dev server and visit `/profile/<any real artist id>` while logged out — confirm the page still renders fully (bio, videos, packages, ratings) and the button area shows the "Are you a venue?" prompt, not a broken/blank area.

- [ ] **Step 6: Commit**

```bash
git add "app/profile/[id]/page.tsx" components/booking/RequestToBookButton.tsx
git commit -m "feat: replace mailto booking inquiry with in-app Request to Book"
```

---

## Task 12: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md**

Add a new bullet to the Core Data Model list, after the `venue_artist_ratings` bullet added by the mutual-ratings feature:

```markdown
  - booking_requests — a venue's date/time request to an artist, with its own pending/accepted/declined lifecycle independent of the artist's Gig calendar. No client-facing RLS policies; every read/write goes through a server route using the service-role client (same reasoning as venue_artist_ratings — RLS can't restrict which columns a party writes, only which rows). Accepting creates a real Gig (see `gig_id`) and, if needed, a linked pipeline `venues` row for that venue under that artist.
```

Add a new "Booking Requests" paragraph to the Key Flows section, after the "Mutual Ratings" paragraph:

```markdown
  Booking Requests — the fourth and final piece of the venue portal. A venue sends a date/time request from any artist's public profile (`/profile/[id]`, a "Request to Book" button that replaces the old mailto "Send Booking Inquiry" link — venues only; anyone else sees a "sign up as a venue" prompt instead). The request form checks the artist's existing confirmed gigs so a venue doesn't submit a request for an unavailable date. The artist reviews pending requests on their existing Booking Calendar (`/calendar`) and accepts or declines. Accepting finds-or-creates a linked pipeline entry for that venue (reusing the same "default zone" pattern Discover Venues' add-to-pipeline flow already uses) and creates a real Gig on it — from that point on it behaves exactly like any other gig, including eventual mutual-ratings eligibility once marked completed. Venues track every request they've sent, and its status, at `/venue/bookings`. Two emails (`lib/email/booking-request-notifications.ts`) keep both sides informed, using the same shared-sender/`profiles.email` pattern as the ratings notifications.
```

- [ ] **Step 2: Append to CHANGELOG.md**

Add a new entry at the top (or under today's date heading if one already exists — check the file first):

```markdown
- [Feature] Booking requests — venues can now request to book an artist for a specific date right from the artist's profile, instead of just emailing them. The artist accepts or declines from their Booking Calendar; once accepted, it's a real gig on their calendar like any other.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document booking requests feature"
```

---

## Final verification (controller, not a subagent task)

Requires a running dev server and a real venue + artist session — subagent workers won't have this. After all 12 tasks pass review:

1. Run `npx tsc --noEmit` and `npx eslint` across the whole project one final time.
2. Ask Taylor to run `supabase/migrations/019_booking_requests.sql` in the Supabase SQL Editor.
3. Ask Taylor to do a live walkthrough: as a venue, visit a real artist's public profile → confirm "Request to Book" opens the form → submit a request for a real date → confirm the artist gets the "new booking request" email and sees it on their Booking Calendar → accept it → confirm a real Gig appears on the calendar with the right date/time/notes, the venue gets the "accepted" email, and (if this venue wasn't already in that artist's pipeline) a new pipeline entry shows up on the Pipeline page linked to the real venue account → separately, test a decline on a second request and confirm the venue gets the "declined" email → confirm the Sidebar's Booking Calendar badge count reflects pending requests correctly → confirm `/venue/bookings` shows accurate statuses for everything sent.
4. Also flag to Taylor the date-picker deliberate adaptation noted at the top of this plan (native date input + inline warning, not a custom greyed-out calendar grid) — confirm she's fine with that tradeoff, or note it as a possible fast-follow if she'd like the fuller visual treatment later.
