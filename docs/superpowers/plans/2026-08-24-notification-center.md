# Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give artists and venues an in-app notification bell (with unread count and dropdown) covering six existing "something happened" moments that today only ever go out as email.

**Architecture:** A new `notifications` table records one row per event per recipient. A shared `createNotification` helper inserts rows; six existing route handlers each get one extra call to it, right alongside the email send they already do. Two new read endpoints power a shared `NotificationBell` component used on both the artist and venue navs, replacing two existing narrower badge mechanisms.

**Tech Stack:** Next.js App Router route handlers, Supabase (service-role client, no RLS — matches `booking_requests`/`venue_artist_ratings`), React client component.

**No automated test suite exists in this project** (confirmed in `CLAUDE.md`). Verification throughout is `npx tsc --noEmit`, `npx eslint`, and manual/live checks.

---

### Task 1: Migration and types

**Files:**
- Create: `supabase/migrations/021_notifications.sql`
- Modify: `types/index.ts` (append after line 330, the end of `VenueBookingRequestView`)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/021_notifications.sql
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent'
  )),
  title text not null,
  body text,
  link text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;

-- RLS is enabled (required so PostgREST doesn't expose this table to
-- anon/authenticated clients directly) but deliberately gets NO policies
-- — every read/write goes through the service-role client from a server
-- route that's already verified the caller's identity. Same pattern as
-- booking_requests and venue_artist_ratings.
alter table public.notifications enable row level security;
```

- [ ] **Step 2: Add the types**

At the end of `types/index.ts`, after the `VenueBookingRequestView` interface, add:

```typescript
// ============================================================
// NOTIFICATIONS
// ============================================================

export type NotificationType =
  | "booking_request_received"
  | "booking_request_accepted"
  | "booking_request_declined"
  | "rating_available"
  | "rating_revealed"
  | "follow_up_sent";

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string;
  read: boolean;
  created_at: string;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors (nothing references the new types yet, so this just confirms no syntax mistakes).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/021_notifications.sql types/index.ts
git commit -m "feat: add notifications table and types"
```

- [ ] **Step 5: Run the migration** — this step is for Taylor, not the agent. Flag clearly at the end of this plan that `021_notifications.sql` needs to run in the Supabase SQL Editor before anything in this feature works.

---

### Task 2: Shared `createNotification` helper

**Files:**
- Create: `lib/notifications/create.ts`

- [ ] **Step 1: Write the helper**

```typescript
// lib/notifications/create.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { NotificationType } from "@/types";

// Never throws — a failed notification insert must never affect whether
// the email alongside it sends, or the action it's attached to. Uses the
// non-throwing { data, error } check (no .throwOnError(), no manual
// throw) so a bad insert genuinely cannot raise an exception; callers
// still wrap this in their own try/catch as defense in depth, matching
// how every other side-effect in this codebase is called.
export async function createNotification(
  service: SupabaseClient,
  params: { userId: string; type: NotificationType; title: string; body?: string; link: string }
): Promise<void> {
  const { error } = await service.from("notifications").insert({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link,
  });
  if (error) console.error("createNotification: insert failed", error);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/notifications/create.ts
git commit -m "feat: add createNotification helper"
```

---

### Task 3: Trigger — booking request received

**Files:**
- Modify: `app/api/venue/booking-requests/route.ts`

**Context:** The POST handler creates a `booking_requests` row, then sends the artist an email (lines 103-107). Add a notification for the artist right after, in its own `try/catch` — not nested inside the email's `try/catch` — so a notification failure can never affect whether the email sends, and vice versa.

- [ ] **Step 1: Add the import**

At the top of `app/api/venue/booking-requests/route.ts`, add alongside the existing imports:

```typescript
import { createNotification } from "@/lib/notifications/create";
```

- [ ] **Step 2: Add the notification call**

Currently (lines 103-107):

```typescript
  try {
    await sendNewBookingRequestEmail(service, created);
  } catch (err) {
    console.error("POST /api/venue/booking-requests: failed to send notification email", err);
  }

  return NextResponse.json(created);
```

Change to:

```typescript
  try {
    await sendNewBookingRequestEmail(service, created);
  } catch (err) {
    console.error("POST /api/venue/booking-requests: failed to send notification email", err);
  }

  try {
    await createNotification(service, {
      userId: created.artist_user_id,
      type: "booking_request_received",
      title: "New booking request",
      link: "/calendar",
    });
  } catch (err) {
    console.error("POST /api/venue/booking-requests: failed to create notification", err);
  }

  return NextResponse.json(created);
```

`created.artist_user_id` is already the artist's real auth user id (it's exactly what was inserted into `booking_requests.artist_user_id`) — no lookup needed.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/venue/booking-requests/route.ts
git commit -m "feat: notify artist when a booking request is received"
```

---

### Task 4: Trigger — booking request accepted / declined

**Files:**
- Modify: `app/api/booking-requests/[id]/route.ts`

**Context:** This PATCH handler has two success paths — decline (lines 44-63) and accept (lines 65-114) — each already sending the venue an email. Both need a notification for the venue, resolved from `venue_profile_id` to the venue's real `user_id` first (the same lookup `sendBookingResponseEmail` already does internally — see `lib/email/booking-request-notifications.ts:57-63` — but the route doesn't have that resolved id available itself, so this task adds a small local resolver).

- [ ] **Step 1: Add imports and a local venue-user-id resolver**

At the top of `app/api/booking-requests/[id]/route.ts`, add:

```typescript
import { createNotification } from "@/lib/notifications/create";
```

After the imports, add a small helper (there's no existing exported version of this exact lookup to reuse — `sendBookingResponseEmail` does the same query internally but doesn't expose the result):

```typescript
async function resolveVenueUserId(service: SupabaseClient, venueProfileId: string): Promise<string | null> {
  const { data, error } = await service
    .from("venue_profiles")
    .select("user_id")
    .eq("id", venueProfileId)
    .maybeSingle();
  if (error) {
    console.error("resolveVenueUserId: lookup failed", error);
    return null;
  }
  return (data?.user_id as string | undefined) ?? null;
}
```

This needs `SupabaseClient` imported too — add `import { SupabaseClient } from "@supabase/supabase-js";` if it isn't already imported in this file (check first; it currently is not).

- [ ] **Step 2: Add the notification call on the decline path**

Currently (lines 57-62):

```typescript
    try {
      await sendBookingResponseEmail(service, updated, "declined");
    } catch (err) {
      console.error("PATCH /api/booking-requests: failed to send decline email", err);
    }
    return NextResponse.json(updated);
```

Change to:

```typescript
    try {
      await sendBookingResponseEmail(service, updated, "declined");
    } catch (err) {
      console.error("PATCH /api/booking-requests: failed to send decline email", err);
    }

    try {
      const venueUserId = await resolveVenueUserId(service, updated.venue_profile_id);
      if (venueUserId) {
        await createNotification(service, {
          userId: venueUserId,
          type: "booking_request_declined",
          title: "Your booking request was declined",
          link: "/venue/bookings",
        });
      }
    } catch (err) {
      console.error("PATCH /api/booking-requests: failed to create decline notification", err);
    }

    return NextResponse.json(updated);
```

- [ ] **Step 3: Add the notification call on the accept path**

Currently (lines 108-113):

```typescript
  try {
    await sendBookingResponseEmail(service, updated, "accepted");
  } catch (err) {
    console.error("PATCH /api/booking-requests: failed to send accept email", err);
  }

  return NextResponse.json(updated);
```

Change to:

```typescript
  try {
    await sendBookingResponseEmail(service, updated, "accepted");
  } catch (err) {
    console.error("PATCH /api/booking-requests: failed to send accept email", err);
  }

  try {
    const venueUserId = await resolveVenueUserId(service, updated.venue_profile_id);
    if (venueUserId) {
      await createNotification(service, {
        userId: venueUserId,
        type: "booking_request_accepted",
        title: "Your booking request was accepted",
        link: "/venue/bookings",
      });
    }
  } catch (err) {
    console.error("PATCH /api/booking-requests: failed to create accept notification", err);
  }

  return NextResponse.json(updated);
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/booking-requests/[id]/route.ts
git commit -m "feat: notify venue when their booking request is accepted or declined"
```

---

### Task 5: Trigger — rating available

**Files:**
- Modify: `app/api/gigs/[id]/route.ts`
- Modify: `lib/email/rating-notifications.ts`

**Context:** `maybeSendNewGigToRateEmails` (`lib/email/rating-notifications.ts:28-102`) already computes, independently, whether the artist needs emailing (`!artistAlreadyRated`) and whether the venue needs emailing (`!venueAlreadyRated && venueProfile?.user_id`) — it can email one party, both, or neither. Rather than duplicating that logic at the call site in `app/api/gigs/[id]/route.ts`, this task extends the function itself to also create the matching notification right where it already knows who's being emailed and why — same file, same conditions, no risk of the two drifting apart later.

- [ ] **Step 1: Add the import to `lib/email/rating-notifications.ts`**

```typescript
import { createNotification } from "@/lib/notifications/create";
```

- [ ] **Step 2: Add a notification call alongside the artist email**

Currently (lines 63-77):

```typescript
  if (!artistAlreadyRated) {
    const { data: artistLogin, error: artistLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", opts.artistUserId)
      .maybeSingle();
    if (artistLoginError) console.error("maybeSendNewGigToRateEmails: profiles (artist login email) lookup failed", artistLoginError);
    if (artistLogin?.email) {
      await sendSystemEmail(
        artistLogin.email as string,
        "You have a new gig to rate on StageReach",
        `Your gig at ${venueName} is marked completed. Head to your Ratings page on StageReach to rate them — you'll see their rating of you once you've both submitted.`
      );
    }
  }
```

Change to (adds the notification call after the email, still inside the `if (!artistAlreadyRated)` block, in its own `try/catch`):

```typescript
  if (!artistAlreadyRated) {
    const { data: artistLogin, error: artistLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", opts.artistUserId)
      .maybeSingle();
    if (artistLoginError) console.error("maybeSendNewGigToRateEmails: profiles (artist login email) lookup failed", artistLoginError);
    if (artistLogin?.email) {
      await sendSystemEmail(
        artistLogin.email as string,
        "You have a new gig to rate on StageReach",
        `Your gig at ${venueName} is marked completed. Head to your Ratings page on StageReach to rate them — you'll see their rating of you once you've both submitted.`
      );
    }
    try {
      await createNotification(service, {
        userId: opts.artistUserId,
        type: "rating_available",
        title: "You have a new gig to rate",
        body: `Your gig at ${venueName} is marked completed.`,
        link: "/ratings",
      });
    } catch (err) {
      console.error("maybeSendNewGigToRateEmails: failed to create artist notification", err);
    }
  }
```

- [ ] **Step 3: Add a notification call alongside the venue email**

Currently (lines 79-101):

```typescript
  if (!venueAlreadyRated && venueProfile?.user_id) {
    const { data: artistProfile, error: artistProfileError } = await service
      .from("artist_profiles")
      .select("display_name")
      .eq("user_id", opts.artistUserId)
      .maybeSingle();
    if (artistProfileError) console.error("maybeSendNewGigToRateEmails: artist_profiles lookup failed", artistProfileError);
    const artistName = (artistProfile?.display_name as string | null) ?? "an artist";

    const { data: venueLogin, error: venueLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", venueProfile.user_id as string)
      .maybeSingle();
    if (venueLoginError) console.error("maybeSendNewGigToRateEmails: profiles (venue login email) lookup failed", venueLoginError);
    if (venueLogin?.email) {
      await sendSystemEmail(
        venueLogin.email as string,
        "You have a new artist to rate on StageReach",
        `Your gig with ${artistName} is marked completed. Head to your Ratings page on StageReach to rate them — you'll see their rating of you once you've both submitted.`
      );
    }
  }
```

Change to (adds the notification call after the email, still inside the same `if` block):

```typescript
  if (!venueAlreadyRated && venueProfile?.user_id) {
    const { data: artistProfile, error: artistProfileError } = await service
      .from("artist_profiles")
      .select("display_name")
      .eq("user_id", opts.artistUserId)
      .maybeSingle();
    if (artistProfileError) console.error("maybeSendNewGigToRateEmails: artist_profiles lookup failed", artistProfileError);
    const artistName = (artistProfile?.display_name as string | null) ?? "an artist";

    const { data: venueLogin, error: venueLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", venueProfile.user_id as string)
      .maybeSingle();
    if (venueLoginError) console.error("maybeSendNewGigToRateEmails: profiles (venue login email) lookup failed", venueLoginError);
    if (venueLogin?.email) {
      await sendSystemEmail(
        venueLogin.email as string,
        "You have a new artist to rate on StageReach",
        `Your gig with ${artistName} is marked completed. Head to your Ratings page on StageReach to rate them — you'll see their rating of you once you've both submitted.`
      );
    }
    try {
      await createNotification(service, {
        userId: venueProfile.user_id as string,
        type: "rating_available",
        title: "You have a new artist to rate",
        body: `Your gig with ${artistName} is marked completed.`,
        link: "/venue/ratings",
      });
    } catch (err) {
      console.error("maybeSendNewGigToRateEmails: failed to create venue notification", err);
    }
  }
```

Note: `app/api/gigs/[id]/route.ts` itself needs NO changes for this task — it already calls `maybeSendNewGigToRateEmails`, and this task's changes live entirely inside that function.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add lib/email/rating-notifications.ts
git commit -m "feat: notify artist and venue when a new rating becomes available"
```

---

### Task 6: Trigger — rating revealed

**Files:**
- Modify: `lib/email/rating-notifications.ts` (`sendRatingRevealedEmail`)

**Context:** Same reasoning as Task 5 — extend the function that already knows exactly who to email, rather than duplicating the branch logic at the two call sites (`app/api/ratings/route.ts` and `app/api/venue/ratings/route.ts`). No changes needed in either route file.

- [ ] **Step 1: Add the notification call on the "artist was waiting" branch**

Currently (lines 120-135):

```typescript
  if (justSubmittedBy === "venue") {
    // Artist was already waiting — notify them.
    const { data: artistLogin, error: artistLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", rating.artist_user_id)
      .maybeSingle();
    if (artistLoginError) console.error("sendRatingRevealedEmail: profiles (artist login email) lookup failed", artistLoginError);
    if (artistLogin?.email) {
      const venueName = (venueProfile?.venue_name as string | null) ?? "A venue";
      await sendSystemEmail(
        artistLogin.email as string,
        `${venueName} revealed their rating of you`,
        `Both ratings are in — head to your Ratings page on StageReach to see it.`
      );
    }
  } else {
```

Change to:

```typescript
  if (justSubmittedBy === "venue") {
    // Artist was already waiting — notify them.
    const { data: artistLogin, error: artistLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", rating.artist_user_id)
      .maybeSingle();
    if (artistLoginError) console.error("sendRatingRevealedEmail: profiles (artist login email) lookup failed", artistLoginError);
    const venueName = (venueProfile?.venue_name as string | null) ?? "A venue";
    if (artistLogin?.email) {
      await sendSystemEmail(
        artistLogin.email as string,
        `${venueName} revealed their rating of you`,
        `Both ratings are in — head to your Ratings page on StageReach to see it.`
      );
    }
    try {
      await createNotification(service, {
        userId: rating.artist_user_id,
        type: "rating_revealed",
        title: `${venueName} revealed their rating of you`,
        link: "/ratings",
      });
    } catch (err) {
      console.error("sendRatingRevealedEmail: failed to create artist notification", err);
    }
  } else {
```

(Note: `venueName` is moved out of the `if (artistLogin?.email)` block since the notification needs it too, regardless of whether the email actually had a recipient.)

- [ ] **Step 2: Add the notification call on the "venue was waiting" branch**

Currently (lines 137-159):

```typescript
  } else {
    // Venue was already waiting — notify them.
    if (!venueProfile?.user_id) return;
    const { data: artistProfile, error: artistProfileError } = await service
      .from("artist_profiles")
      .select("display_name")
      .eq("user_id", rating.artist_user_id)
      .maybeSingle();
    if (artistProfileError) console.error("sendRatingRevealedEmail: artist_profiles lookup failed", artistProfileError);
    const { data: venueLogin, error: venueLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", venueProfile.user_id as string)
      .maybeSingle();
    if (venueLoginError) console.error("sendRatingRevealedEmail: profiles (venue login email) lookup failed", venueLoginError);
    if (venueLogin?.email) {
      const artistName = (artistProfile?.display_name as string | null) ?? "An artist";
      await sendSystemEmail(
        venueLogin.email as string,
        `${artistName} revealed their rating of you`,
        `Both ratings are in — head to your Ratings page on StageReach to see it.`
      );
    }
  }
```

Change to:

```typescript
  } else {
    // Venue was already waiting — notify them.
    if (!venueProfile?.user_id) return;
    const { data: artistProfile, error: artistProfileError } = await service
      .from("artist_profiles")
      .select("display_name")
      .eq("user_id", rating.artist_user_id)
      .maybeSingle();
    if (artistProfileError) console.error("sendRatingRevealedEmail: artist_profiles lookup failed", artistProfileError);
    const artistName = (artistProfile?.display_name as string | null) ?? "An artist";
    const { data: venueLogin, error: venueLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", venueProfile.user_id as string)
      .maybeSingle();
    if (venueLoginError) console.error("sendRatingRevealedEmail: profiles (venue login email) lookup failed", venueLoginError);
    if (venueLogin?.email) {
      await sendSystemEmail(
        venueLogin.email as string,
        `${artistName} revealed their rating of you`,
        `Both ratings are in — head to your Ratings page on StageReach to see it.`
      );
    }
    try {
      await createNotification(service, {
        userId: venueProfile.user_id as string,
        type: "rating_revealed",
        title: `${artistName} revealed their rating of you`,
        link: "/venue/ratings",
      });
    } catch (err) {
      console.error("sendRatingRevealedEmail: failed to create venue notification", err);
    }
  }
```

(Same note: `artistName` moved out of the `if (venueLogin?.email)` block so the notification can use it too.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/email/rating-notifications.ts
git commit -m "feat: notify both parties when a rating relationship reveals"
```

---

### Task 7: Trigger — follow-up email sent

**Files:**
- Modify: `app/api/venues/follow-up/route.ts`

**Context:** This route loops over every eligible venue, sending one follow-up email per iteration inside a per-venue `try/catch` (the whole email-send-plus-logging block, not just the email call). Unlike the other trigger points, wrap the notification call in its own *nested* `try/catch` right after `results.push({ venue: venue.name, status: "sent" })` — this file's structure is different enough (a loop, not a single request) that pattern-matching Tasks 3-6 exactly isn't the fit; the goal is the same: a notification failure must not turn a genuinely successful email send into a reported `"error"` for that venue.

- [ ] **Step 1: Add the import**

```typescript
import { createNotification } from "@/lib/notifications/create";
```

- [ ] **Step 2: Add the notification call**

Currently:

```typescript
      results.push({ venue: venue.name, status: "sent" });
    } catch (err) {
      console.error(`follow-up: unexpected error for venue ${venue.name}:`, err);
      results.push({ venue: venue.name, status: `error: ${err}` });
    }
```

Change to:

```typescript
      results.push({ venue: venue.name, status: "sent" });

      try {
        await createNotification(supabase, {
          userId: venue.user_id,
          type: "follow_up_sent",
          title: "Follow-up email sent",
          body: `A follow-up went out to ${venue.name} automatically.`,
          link: "/pipeline",
        });
      } catch (notifyErr) {
        console.error(`follow-up: failed to create notification for venue ${venue.name}:`, notifyErr);
      }
    } catch (err) {
      console.error(`follow-up: unexpected error for venue ${venue.name}:`, err);
      results.push({ venue: venue.name, status: `error: ${err}` });
    }
```

`venue.user_id` here is the artist's own account id (this route's `venues` are pipeline rows owned by an artist, not `venue_profiles` accounts — no id resolution needed, unlike Tasks 4-6).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/venues/follow-up/route.ts
git commit -m "feat: notify artist when the automated follow-up email sends"
```

---

### Task 8: Read endpoints

**Files:**
- Create: `app/api/notifications/route.ts`
- Create: `app/api/notifications/mark-read/route.ts`

- [ ] **Step 1: Write the GET endpoint**

```typescript
// app/api/notifications/route.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NotificationView } from "@/types";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();

  const { data: rows, error } = await service
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count: unreadCount, error: countError } = await service
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

  const notifications: NotificationView[] = (rows ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    read: r.read_at !== null,
    created_at: r.created_at,
  }));

  return NextResponse.json({ notifications, unreadCount: unreadCount ?? 0 });
}
```

- [ ] **Step 2: Write the mark-read endpoint**

```typescript
// app/api/notifications/mark-read/route.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function PATCH() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const { error } = await service
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/notifications/route.ts app/api/notifications/mark-read/route.ts
git commit -m "feat: add GET /api/notifications and PATCH mark-read endpoints"
```

---

### Task 9: NotificationBell component, wired into both navs

**Files:**
- Create: `components/notifications/NotificationBell.tsx`
- Modify: `components/layout/Sidebar.tsx`
- Modify: `components/venue/VenueNav.tsx`

**Context:** This is the biggest single task in the plan — read both nav files' current content directly before editing (line numbers below are from the versions read while writing this plan; re-verify against the actual files, they may have drifted slightly).

The dropdown's `align`/`dropUp` props (added to `NotificationBell` in Step 1) matter here: the desktop Sidebar is only 224px wide, so its bell needs `align="left"` (a right-pinned 320px dropdown would run off the left edge of the screen). `MobileBottomNav` is pinned to the bottom of the viewport, so its bell needs `dropUp` (a below-anchored dropdown would render off-screen). `VenueNav`'s bell sits near the left edge of its bar too (right after the wordmark, before the links, in a bar with no spacer pushing content apart), so it also needs `align="left"` — no `dropUp` there, since that bar isn't pinned to the bottom of the viewport.

- [ ] **Step 1: Write the component**

```tsx
// components/notifications/NotificationBell.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { NotificationView } from "@/types";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Pass listenForRefreshEvents=true only where the existing
// stagereach:profile-updated / stagereach:booking-request-updated events
// are actually dispatched today (the artist side) — they're never fired
// from venue-side code, so passing true there would just add two dead
// listeners. See the design spec's "Known trade-off" section for why
// this asymmetry is intentional, not a bug.
//
// align controls which side the dropdown's edge is pinned to — pass
// "left" whenever the bell sits closer to the left side of its bar than
// the right (the desktop Sidebar, and VenueNav's bar, which packs its
// items to the left with no spacer), so the dropdown grows rightward
// into open space instead of running off the left edge of the screen.
// The "right" default suits a bell placed near the right edge of a bar
// (no current call site does this yet, but it's there if one needs it).
//
// dropUp renders the dropdown above the bell instead of below — needed
// for MobileBottomNav, which is pinned to the bottom of the viewport, so
// a below-anchored dropdown would render off-screen.
export default function NotificationBell({
  listenForRefreshEvents = false,
  align = "right",
  dropUp = false,
}: {
  listenForRefreshEvents?: boolean;
  align?: "left" | "right";
  dropUp?: boolean;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function load() {
      fetch("/api/notifications")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setNotifications(data?.notifications ?? []);
          setUnreadCount(data?.unreadCount ?? 0);
        })
        .catch(() => {});
    }
    load();
    if (!listenForRefreshEvents) return;
    window.addEventListener("stagereach:profile-updated", load);
    window.addEventListener("stagereach:booking-request-updated", load);
    return () => {
      window.removeEventListener("stagereach:profile-updated", load);
      window.removeEventListener("stagereach:booking-request-updated", load);
    };
  }, [listenForRefreshEvents]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleToggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && unreadCount > 0) {
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      fetch("/api/notifications/mark-read", { method: "PATCH" }).catch(() => {});
    }
  }

  function handleClickNotification(n: NotificationView) {
    setOpen(false);
    router.push(n.link);
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={handleToggle}
        className="relative flex items-center justify-center transition-all hover:brightness-125"
        style={{ width: "32px", height: "32px", color: "#9a9591" }}
        aria-label="Notifications"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute", top: "2px", right: "2px",
              backgroundColor: "#D4A64F", color: "#0E0E10",
              fontSize: "9px", fontWeight: 700, borderRadius: "999px",
              minWidth: "15px", height: "15px", display: "flex",
              alignItems: "center", justifyContent: "center", padding: "0 3px",
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            position: "absolute",
            ...(dropUp ? { bottom: "40px" } : { top: "40px" }),
            ...(align === "left" ? { left: "0" } : { right: "0" }),
            width: "320px", maxWidth: "calc(100vw - 32px)", maxHeight: "400px", overflowY: "auto",
            backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)",
            zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {notifications.length === 0 ? (
            <p className="text-sm p-4 text-center" style={{ color: "#5e5c58" }}>Nothing yet</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClickNotification(n)}
                className="w-full text-left px-4 py-3 transition-all hover:brightness-125"
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  backgroundColor: n.read ? "transparent" : "rgba(212,166,79,0.06)",
                }}
              >
                <div className="text-sm font-medium" style={{ color: "#F4E8D2" }}>{n.title}</div>
                {n.body && <div className="text-xs mt-0.5" style={{ color: "#9a9591" }}>{n.body}</div>}
                <div className="text-xs mt-1" style={{ color: "#5e5c58" }}>{timeAgo(n.created_at)}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `Sidebar.tsx`'s desktop sidebar**

Remove the `pendingRatingsCount`/`pendingBookingRequestsCount` state (lines 28-29). Inside the `useEffect` (lines 31-70), keep the `loadProfile` function and its call, its `stagereach:profile-updated` listener, and the initial `loadProfile()` call — remove everything else: the `/api/ratings/pending` fetch block (lines 46-49), the `loadPendingBookingRequests` function and its call (lines 51-58), and the `stagereach:booking-request-updated` add/remove listener pair (lines 65 and 68).

Remove `badge: null` from every entry in the `mainLinks` array (lines 10-16) — it's dead once the badge logic below is gone. Remove the `badgeValue` computation entirely (lines 119-122) and the `{badgeValue && (...)}` block that renders it (lines 141-159), rather than leaving an always-`null` reference around.

Add the import:

```typescript
import NotificationBell from "@/components/notifications/NotificationBell";
```

Add `<NotificationBell listenForRefreshEvents align="left" />` in the logo area, right after the `<Image>` closing tag and before the `</div>` that closes the logo section (around line 96-97), so it sits directly under the StageReach wordmark:

```tsx
        <Image
          src="/stagereach-logo.png"
          alt="StageReach"
          width={192}
          height={64}
          className="w-full"
          style={{ objectFit: "contain", objectPosition: "left" }}
        />
        <div className="flex justify-end mt-2">
          <NotificationBell listenForRefreshEvents align="left" />
        </div>
      </div>
```

- [ ] **Step 3: Wire into `Sidebar.tsx`'s `MobileBottomNav`**

Add the same bell as a 7th item in the bottom nav bar, alongside the existing `Link`-based items. Since `NotificationBell` manages its own click/dropdown (not a `Link` navigation), render it directly rather than through the `mobileLinks.map(...)` loop:

```tsx
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 py-2"
      style={{ backgroundColor: "#16181c", borderTop: "1px solid rgba(255,255,255,0.07)" }}
    >
      {mobileLinks.map((link) => {
        const isActive = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all"
            style={{ color: isActive ? "#D4A64F" : "#5e5c58" }}
          >
            <span style={{ fontSize: "16px" }}>{link.icon}</span>
            <span style={{ fontSize: "9px", fontWeight: isActive ? 600 : 400 }}>{link.label}</span>
          </Link>
        );
      })}
      <div className="flex flex-col items-center gap-0.5 px-3 py-1">
        <NotificationBell listenForRefreshEvents dropUp />
      </div>
    </nav>
```

`dropUp` renders the dropdown above the bell instead of below, since this nav bar is pinned to the bottom of the viewport — a below-anchored dropdown would render off-screen. `align` stays at its default (`"right"`), which keeps the dropdown on-screen horizontally in this bottom-right nav slot; `maxWidth: calc(100vw - 32px)` already in the component handles narrow phones.

- [ ] **Step 4: Wire into `VenueNav.tsx`**

Remove `pendingRatingsCount` state, its `useEffect` fetch, and the `badge` computation/render on the `/venue/ratings` link (the link itself stays, just loses its number badge). This also removes the only uses of `useState`/`useEffect` in this file — change `import { useState, useEffect } from "react";` to drop entirely (this file only ever used `usePathname` from `next/navigation` otherwise, which stays). Add the `NotificationBell` import and render `<NotificationBell align="left" />` (no `listenForRefreshEvents` prop — leave it `false`, per the spec's documented asymmetry) inside the nav bar, after the `StageReach` wordmark and before the mapped links. **Use `align="left"` here, not the component's default** — this nav bar is `flex items-center gap-6` with no spacer pushing content apart, so the bell ends up near the *left* edge of the bar (right after the wordmark, well before the links), not the right edge; a right-pinned dropdown at that position would run off the left edge of the screen, the same class of bug `align="left"` already fixes for the narrow desktop Sidebar:

```tsx
      <div style={{ fontFamily: "serif", fontSize: "1rem", color: "#D4A64F", fontWeight: 600 }}>
        StageReach
      </div>
      <NotificationBell align="left" />
      {links.map((link) => {
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Lint**

Run: `npx eslint components/notifications/NotificationBell.tsx components/layout/Sidebar.tsx components/venue/VenueNav.tsx`
Expected: No new errors (pre-existing warnings elsewhere in the project are fine).

- [ ] **Step 7: Commit**

```bash
git add components/notifications/NotificationBell.tsx components/layout/Sidebar.tsx components/venue/VenueNav.tsx
git commit -m "feat: add NotificationBell, replace per-page badge counts"
```

---

### Task 10: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md**

Add a new paragraph in the Key Flows section (after the Booking Requests paragraph) describing the notification center: a `notifications` table (migration `021_notifications.sql`, no RLS, service-role only) covering six events (booking request received/accepted/declined, rating available, rating revealed, follow-up sent), created via `lib/notifications/create.ts`'s `createNotification` alongside each event's existing email send, read via `GET /api/notifications` / `PATCH /api/notifications/mark-read`, displayed via a shared `components/notifications/NotificationBell.tsx` on both the artist (`Sidebar.tsx`, desktop and mobile) and venue (`VenueNav.tsx`) navs — which replaced the narrower `pendingRatingsCount`/`pendingBookingRequestsCount` badges those navs used to compute independently.

- [ ] **Step 2: Add a CHANGELOG entry**

```
## 2026-08-24 (notification center)
- [Feature] A new notification bell in the nav (both artist and venue sides) covers new booking requests, accepted/declined responses, ratings becoming available or revealing, and automated follow-up emails sending — all of which previously only ever showed up as an email. Replaces the smaller number badges that used to live on the Calendar and Ratings nav links.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document the notification center"
```

---

### Task 11: Manual verification

No automated test suite exists in this project. Verify with a live dev server, seeding test data directly via the Supabase REST API (service-role key from `.env.local`) where a real trigger is impractical to exercise through the UI alone:

- [ ] Confirm the dev server builds and runs without errors after the migration has been applied.
- [ ] As an artist, confirm the bell appears in the desktop sidebar and in the mobile bottom nav, with no unread count when there are no notifications.
- [ ] Seed a `booking_requests` insert directly (or trigger one through the real venue-request flow if a test venue account is available) and confirm: an artist notification appears, the bell's badge count increments, clicking it navigates to `/calendar`, and the existing email still sends (check server logs / Resend dashboard, don't just assume).
- [ ] Accept or decline that request and confirm the venue side gets a matching notification, and the existing accept/decline email still sends.
- [ ] Confirm the Calendar and Ratings nav links on the artist Sidebar, and the Ratings link on VenueNav, no longer show their old individual number badges.
- [ ] Confirm opening the bell's dropdown clears the unread badge to zero immediately, and that a page reload afterward still shows 0 unread (proving the mark-read PATCH actually persisted, not just local state).
- [ ] Confirm the venue-side bell (`VenueNav.tsx`) still shows the correct count on next page load after an accept/decline (since it has no live in-tab refresh by design — this should require a navigation/reload to update, not update instantly).
