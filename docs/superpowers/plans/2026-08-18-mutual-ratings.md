# Mutual Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let venues and artists rate each other 1-5 stars (double-blind, one rating per relationship ever) once they've had a real, verified interaction — a completed gig at a venue linked to a real StageReach account — and show those ratings publicly.

**Architecture:** One new table (`venue_artist_ratings`) holds both sides of a relationship's rating as two independent halves in a single row; a "revealed" state is computed at read time (both halves filled in), never stored. Every read/write to this table goes through a server API route using the service-role client — this table has RLS enabled with zero client-facing policies, since Postgres RLS can't hide half a row. Two shared helper modules (`lib/ratings/eligibility.ts`, `lib/email/rating-notifications.ts`) centralize the eligibility/validation logic and the two email triggers so the artist-side and venue-side API routes stay thin mirrors of each other instead of duplicating logic.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), Resend (email), TypeScript. No automated test suite exists in this project — verification is `npx tsc --noEmit`, `npx eslint`, the Supabase SQL Editor for migrations, and manual/live checks with real accounts.

**Spec:** `docs/superpowers/specs/2026-08-18-mutual-ratings-design.md` — read this first for full rationale. This plan implements it task-by-task.

---

## Before you start

Two things this plan gets exactly right that a previous review round caught as real, build-breaking bugs — do not deviate from these:

1. **The new public venue page is `/venues/profile/[id]`, NOT `/venues/[id]`.** `/venues/[id]` is already an existing *private* page (`app/(protected)/venues/[id]/page.tsx`) — reusing it collides and fails the build.
2. **The `proxy.ts` middleware fix uses scoped prefixes** (`/venues/profile/` and `/api/public/`), **never a blanket `/venues/` prefix** — that would also expose the existing private `/venues/import` and `/venues/[id]` pages without login.

---

## Task 1: Migration — `venue_artist_ratings` and `venue_artist_rating_reports`

**Files:**
- Create: `supabase/migrations/018_venue_artist_ratings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- MUTUAL RATINGS
-- One row per venue-artist relationship, holding BOTH sides'
-- rating as two independent halves (not two separate rows).
-- "Revealed" means both *_rated_at are non-null — computed at
-- read time by API routes, never stored as a flag.
--
-- No client-facing RLS policies on either table below — Postgres
-- RLS controls which ROWS a query sees, not which COLUMNS, so
-- there's no way to express "hide the venue's half until the
-- artist's half is also filled in" with row-level policies alone.
-- Every read and write goes through a server route using the
-- service-role client, which decides in code what to return.
-- ============================================================

create table public.venue_artist_ratings (
  id                  uuid primary key default gen_random_uuid(),
  venue_profile_id    uuid not null references public.venue_profiles(id) on delete cascade,
  artist_user_id      uuid not null references public.profiles(id) on delete cascade,
  qualifying_gig_id   uuid references public.gigs(id) on delete set null,

  venue_stars         smallint check (venue_stars between 1 and 5),
  venue_review        text,
  venue_rated_at      timestamptz,

  artist_stars        smallint check (artist_stars between 1 and 5),
  artist_review       text,
  artist_rated_at     timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (venue_profile_id, artist_user_id)
);

create trigger venue_artist_ratings_updated_at
  before update on public.venue_artist_ratings
  for each row execute function update_updated_at();

alter table public.venue_artist_ratings enable row level security;
-- Deliberately no policies — see header comment above.

create table public.venue_artist_rating_reports (
  id                  uuid primary key default gen_random_uuid(),
  rating_id           uuid not null references public.venue_artist_ratings(id) on delete cascade,
  reporter_user_id    uuid not null references public.profiles(id) on delete cascade,
  reason              text,
  created_at          timestamptz not null default now()
);

alter table public.venue_artist_rating_reports enable row level security;
-- Deliberately no policies — reports are only ever written/read via the
-- service-role client from POST /api/ratings/[id]/report.
```

- [ ] **Step 2: Verify `update_updated_at()` exists**

Run: `grep -rn "create.*function update_updated_at" supabase/migrations/`
Expected: at least one match (it's used by `venue_profiles` already — confirms the trigger above will work without also defining the function).

- [ ] **Step 3: Apply the migration**

This project has no migration-runner — Taylor applies migrations manually via the Supabase SQL Editor. At the end of this plan, tell Taylor to run `supabase/migrations/018_venue_artist_ratings.sql` there. Nothing in this task requires it to be applied yet — later tasks reference the table by name and will only be runtime-testable once it's applied.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/018_venue_artist_ratings.sql
git commit -m "feat: add venue_artist_ratings and venue_artist_rating_reports tables"
```

---

## Task 2: Types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the new types**

Add near the bottom of `types/index.ts`, after the existing `VenueMatchCandidate` interface:

```typescript
// ============================================================
// MUTUAL RATINGS
// ============================================================

// The raw shape of a venue_artist_ratings row as stored — used only
// server-side. API responses never send this shape directly to a
// client; they shape it into RatingView (below) so an unrevealed
// half is never even present in the JSON, not just hidden in the UI.
export interface VenueArtistRatingRow {
  id: string;
  venue_profile_id: string;
  artist_user_id: string;
  qualifying_gig_id: string | null;
  venue_stars: number | null;
  venue_review: string | null;
  venue_rated_at: string | null;
  artist_stars: number | null;
  artist_review: string | null;
  artist_rated_at: string | null;
  created_at: string;
  updated_at: string;
}

// What an API route actually returns to a client — always includes the
// caller's own half, includes the counterpart's half only if `revealed`.
export interface RatingView {
  id: string;
  venue_profile_id: string;
  artist_user_id: string;
  revealed: boolean;
  my_stars: number;
  my_review: string | null;
  their_stars: number | null;
  their_review: string | null;
  counterpart_name: string;
  counterpart_photo_url: string | null;
}

export interface PendingRating {
  venue_profile_id?: string;   // present on the artist's pending list
  artist_user_id?: string;     // present on the venue's pending list
  counterpart_name: string;
  counterpart_photo_url: string | null;
  qualifying_gig_id: string;
  qualifying_gig_date: string;
}

export interface PublicRatingsResponse {
  average: number | null;
  count: number;
  reviews: {
    reviewer_name: string;
    reviewer_photo_url: string | null;
    stars: number;
    review: string | null;
  }[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add mutual ratings types"
```

---

## Task 3: Shared eligibility/validation helper

**Files:**
- Create: `lib/ratings/eligibility.ts`

This is the one module every rating API route (artist and venue side) depends on. Keeping it separate from the routes means the two sides stay thin, symmetric mirrors of each other rather than duplicating this logic twice.

- [ ] **Step 1: Write the helper**

```typescript
// lib/ratings/eligibility.ts
import { SupabaseClient } from "@supabase/supabase-js";

export interface ArtistPendingItem {
  venue_profile_id: string;
  counterpart_name: string;
  counterpart_photo_url: string | null;
  qualifying_gig_id: string;
  qualifying_gig_date: string;
}

export interface VenuePendingItem {
  artist_user_id: string;
  counterpart_name: string;
  counterpart_photo_url: string | null;
  qualifying_gig_id: string;
  qualifying_gig_date: string;
}

// Every venue this artist has a completed gig at, where that venue is
// linked to a real account AND the artist hasn't rated it yet. Takes the
// EARLIEST completed+linked gig per venue as the qualifying gig (gigs are
// fetched ordered by date ascending, and only the first one seen per venue
// is kept). "Hasn't rated yet" is checked purely by whether their half of
// an existing row is filled in — a rating opportunity is per RELATIONSHIP,
// not per gig, so playing the same venue again never re-adds it here once
// rated.
export async function getArtistPendingRelationships(
  service: SupabaseClient,
  artistUserId: string
): Promise<ArtistPendingItem[]> {
  const { data: gigs, error: gigsError } = await service
    .from("gigs")
    .select("id, date, venue_id")
    .eq("user_id", artistUserId)
    .eq("status", "completed")
    .order("date", { ascending: true });
  if (gigsError) throw gigsError;
  if (!gigs || gigs.length === 0) return [];

  const venueIds = [...new Set(gigs.map((g) => g.venue_id as string))];
  const { data: venues, error: venuesError } = await service
    .from("venues")
    .select("id, venue_profile_id")
    .in("id", venueIds)
    .not("venue_profile_id", "is", null);
  if (venuesError) throw venuesError;

  const profileIdByVenueId = new Map(
    (venues ?? []).map((v) => [v.id as string, v.venue_profile_id as string])
  );

  const earliestByProfile = new Map<string, { gigId: string; date: string }>();
  for (const gig of gigs) {
    const profileId = profileIdByVenueId.get(gig.venue_id as string);
    if (!profileId) continue;
    if (!earliestByProfile.has(profileId)) {
      earliestByProfile.set(profileId, { gigId: gig.id as string, date: gig.date as string });
    }
  }
  if (earliestByProfile.size === 0) return [];

  const profileIds = [...earliestByProfile.keys()];
  const { data: existing, error: existingError } = await service
    .from("venue_artist_ratings")
    .select("venue_profile_id, artist_rated_at")
    .eq("artist_user_id", artistUserId)
    .in("venue_profile_id", profileIds);
  if (existingError) throw existingError;

  const alreadyRated = new Set(
    (existing ?? []).filter((r) => r.artist_rated_at != null).map((r) => r.venue_profile_id as string)
  );

  const stillPending = profileIds.filter((id) => !alreadyRated.has(id));
  if (stillPending.length === 0) return [];

  const { data: profiles, error: profilesError } = await service
    .from("venue_profiles")
    .select("id, venue_name, photo_url")
    .in("id", stillPending);
  if (profilesError) throw profilesError;
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return stillPending.map((id) => {
    const g = earliestByProfile.get(id)!;
    const p = profileById.get(id);
    return {
      venue_profile_id: id,
      counterpart_name: p?.venue_name ?? "A venue",
      counterpart_photo_url: (p?.photo_url as string | null) ?? null,
      qualifying_gig_id: g.gigId,
      qualifying_gig_date: g.date,
    };
  });
}

// Mirror of the above for a venue looking at eligible artists.
export async function getVenuePendingRelationships(
  service: SupabaseClient,
  venueProfileId: string
): Promise<VenuePendingItem[]> {
  const { data: venueRows, error: venueRowsError } = await service
    .from("venues")
    .select("id, user_id")
    .eq("venue_profile_id", venueProfileId);
  if (venueRowsError) throw venueRowsError;
  if (!venueRows || venueRows.length === 0) return [];

  const venueRowIds = venueRows.map((v) => v.id as string);
  const artistByVenueRowId = new Map(venueRows.map((v) => [v.id as string, v.user_id as string]));

  const { data: gigs, error: gigsError } = await service
    .from("gigs")
    .select("id, date, venue_id")
    .in("venue_id", venueRowIds)
    .eq("status", "completed")
    .order("date", { ascending: true });
  if (gigsError) throw gigsError;
  if (!gigs || gigs.length === 0) return [];

  const earliestByArtist = new Map<string, { gigId: string; date: string }>();
  for (const gig of gigs) {
    const artistUserId = artistByVenueRowId.get(gig.venue_id as string);
    if (!artistUserId) continue;
    if (!earliestByArtist.has(artistUserId)) {
      earliestByArtist.set(artistUserId, { gigId: gig.id as string, date: gig.date as string });
    }
  }
  if (earliestByArtist.size === 0) return [];

  const artistUserIds = [...earliestByArtist.keys()];
  const { data: existing, error: existingError } = await service
    .from("venue_artist_ratings")
    .select("artist_user_id, venue_rated_at")
    .eq("venue_profile_id", venueProfileId)
    .in("artist_user_id", artistUserIds);
  if (existingError) throw existingError;

  const alreadyRated = new Set(
    (existing ?? []).filter((r) => r.venue_rated_at != null).map((r) => r.artist_user_id as string)
  );

  const stillPending = artistUserIds.filter((id) => !alreadyRated.has(id));
  if (stillPending.length === 0) return [];

  const { data: artists, error: artistsError } = await service
    .from("artist_profiles")
    .select("user_id, display_name, photo_url")
    .in("user_id", stillPending);
  if (artistsError) throw artistsError;
  const artistByUserId = new Map((artists ?? []).map((a) => [a.user_id as string, a]));

  return stillPending.map((id) => {
    const g = earliestByArtist.get(id)!;
    const a = artistByUserId.get(id);
    return {
      artist_user_id: id,
      counterpart_name: (a?.display_name as string | null) ?? "An artist",
      counterpart_photo_url: (a?.photo_url as string | null) ?? null,
      qualifying_gig_id: g.gigId,
      qualifying_gig_date: g.date,
    };
  });
}

// First-submission-only check: proves the supplied gig actually ties THIS
// caller to THIS specific relationship — not just that they own some
// completed gig somewhere. Without this, a caller could attach an
// unrelated completed gig they own to rate a venue/artist they never
// worked with.
export async function validateQualifyingGig(
  service: SupabaseClient,
  opts: { gigId: string; venueProfileId: string; artistUserId: string }
): Promise<{ valid: true } | { valid: false; error: string }> {
  const { data: gig, error } = await service
    .from("gigs")
    .select("id, status, user_id, venue_id")
    .eq("id", opts.gigId)
    .maybeSingle();
  if (error) throw error;
  if (!gig) return { valid: false, error: "Gig not found" };
  if (gig.status !== "completed") return { valid: false, error: "That gig isn't marked completed" };
  if (gig.user_id !== opts.artistUserId) return { valid: false, error: "That gig doesn't belong to this artist" };

  const { data: venue, error: venueError } = await service
    .from("venues")
    .select("venue_profile_id")
    .eq("id", gig.venue_id)
    .maybeSingle();
  if (venueError) throw venueError;
  if (!venue || venue.venue_profile_id !== opts.venueProfileId) {
    return { valid: false, error: "That gig isn't linked to this venue" };
  }

  return { valid: true };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ratings/eligibility.ts
git commit -m "feat: add ratings eligibility and validation helpers"
```

---

## Task 4: Email notification helper

**Files:**
- Create: `lib/email/rating-notifications.ts`

Two triggers, both described in the spec: "new gig to rate" (fired from the gig PATCH handler, Task 9) and "rating revealed" (fired from the two POST routes, Tasks 5-6). Both send via Resend directly using the shared `booking@stagereach.app` sender — these are platform notifications about the user's own account, not pitch emails sent on an artist's behalf, so they deliberately don't go through `sendArtistEmail`.

- [ ] **Step 1: Write the helper**

```typescript
// lib/email/rating-notifications.ts
import { Resend } from "resend";
import { SupabaseClient } from "@supabase/supabase-js";

async function sendSystemEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail) {
    console.error("rating-notifications: Resend not configured (missing API key or from address)");
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `StageReach <${fromEmail}>`,
    to,
    subject,
    text,
  });
  if (error) console.error("rating-notifications: send failed", error);
}

// Fired from PATCH /api/gigs/[id] the moment a gig transitions to
// "completed" on a linked venue. Guards against re-sending to a side
// that's already rated this relationship — without this check, a venue
// and artist who work together repeatedly would get "new gig to rate"
// on every subsequent completed gig even after the relationship was
// already fully rated (one rating per relationship, ever).
export async function maybeSendNewGigToRateEmails(
  service: SupabaseClient,
  opts: { artistUserId: string; venueId: string }
): Promise<void> {
  const { data: venue } = await service
    .from("venues")
    .select("venue_profile_id, name")
    .eq("id", opts.venueId)
    .maybeSingle();

  const venueProfileId = venue?.venue_profile_id as string | null;
  if (!venueProfileId) return; // not a linked venue — no rating opportunity exists at all

  const { data: existing } = await service
    .from("venue_artist_ratings")
    .select("artist_rated_at, venue_rated_at")
    .eq("venue_profile_id", venueProfileId)
    .eq("artist_user_id", opts.artistUserId)
    .maybeSingle();

  const artistAlreadyRated = !!existing?.artist_rated_at;
  const venueAlreadyRated = !!existing?.venue_rated_at;
  if (artistAlreadyRated && venueAlreadyRated) return; // fully rated already — nothing new for either side

  const { data: venueProfile } = await service
    .from("venue_profiles")
    .select("user_id, venue_name")
    .eq("id", venueProfileId)
    .maybeSingle();

  const venueName = (venueProfile?.venue_name as string | null) ?? venue?.name ?? "a venue";

  if (!artistAlreadyRated) {
    const { data: artistLogin } = await service
      .from("profiles")
      .select("email")
      .eq("id", opts.artistUserId)
      .maybeSingle();
    if (artistLogin?.email) {
      await sendSystemEmail(
        artistLogin.email as string,
        "You have a new gig to rate on StageReach",
        `Your gig at ${venueName} is marked completed. Head to your Ratings page on StageReach to rate them — you'll see their rating of you once you've both submitted.`
      );
    }
  }

  if (!venueAlreadyRated && venueProfile?.user_id) {
    const { data: artistProfile } = await service
      .from("artist_profiles")
      .select("display_name")
      .eq("user_id", opts.artistUserId)
      .maybeSingle();
    const artistName = (artistProfile?.display_name as string | null) ?? "an artist";

    const { data: venueLogin } = await service
      .from("profiles")
      .select("email")
      .eq("id", venueProfile.user_id as string)
      .maybeSingle();
    if (venueLogin?.email) {
      await sendSystemEmail(
        venueLogin.email as string,
        "You have a new artist to rate on StageReach",
        `Your gig with ${artistName} is marked completed. Head to your Ratings page on StageReach to rate them — you'll see their rating of you once you've both submitted.`
      );
    }
  }
}

// Fired from inside POST /api/ratings and POST /api/venue/ratings, only when
// this specific submission was the one that caused the SECOND half to fill
// in. Notifies only whichever side had already submitted and was waiting —
// `justSubmittedBy` tells it which side to skip.
export async function sendRatingRevealedEmail(
  service: SupabaseClient,
  rating: { venue_profile_id: string; artist_user_id: string },
  justSubmittedBy: "artist" | "venue"
): Promise<void> {
  const { data: venueProfile } = await service
    .from("venue_profiles")
    .select("user_id, venue_name")
    .eq("id", rating.venue_profile_id)
    .maybeSingle();

  if (justSubmittedBy === "venue") {
    // Artist was already waiting — notify them.
    const { data: artistLogin } = await service
      .from("profiles")
      .select("email")
      .eq("id", rating.artist_user_id)
      .maybeSingle();
    if (artistLogin?.email) {
      const venueName = (venueProfile?.venue_name as string | null) ?? "A venue";
      await sendSystemEmail(
        artistLogin.email as string,
        `${venueName} revealed their rating of you`,
        `Both ratings are in — head to your Ratings page on StageReach to see it.`
      );
    }
  } else {
    // Venue was already waiting — notify them.
    if (!venueProfile?.user_id) return;
    const { data: artistProfile } = await service
      .from("artist_profiles")
      .select("display_name")
      .eq("user_id", rating.artist_user_id)
      .maybeSingle();
    const { data: venueLogin } = await service
      .from("profiles")
      .select("email")
      .eq("id", venueProfile.user_id as string)
      .maybeSingle();
    if (venueLogin?.email) {
      const artistName = (artistProfile?.display_name as string | null) ?? "An artist";
      await sendSystemEmail(
        venueLogin.email as string,
        `${artistName} revealed their rating of you`,
        `Both ratings are in — head to your Ratings page on StageReach to see it.`
      );
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/email/rating-notifications.ts
git commit -m "feat: add rating notification email helpers"
```

---

## Task 5: Artist rating API routes

**Files:**
- Create: `app/api/ratings/pending/route.ts`
- Create: `app/api/ratings/route.ts`

- [ ] **Step 1: Write the pending-list route**

```typescript
// app/api/ratings/pending/route.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getArtistPendingRelationships } from "@/lib/ratings/eligibility";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  try {
    const pending = await getArtistPendingRelationships(service, user.id);
    return NextResponse.json({ pending });
  } catch (err) {
    console.error("GET /api/ratings/pending failed", err);
    return NextResponse.json({ error: "Failed to load pending ratings" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the GET/POST route**

```typescript
// app/api/ratings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { validateQualifyingGig } from "@/lib/ratings/eligibility";
import { sendRatingRevealedEmail } from "@/lib/email/rating-notifications";
import { RatingView } from "@/types";

async function shapeRow(
  service: SupabaseClient,
  row: {
    id: string; venue_profile_id: string; artist_user_id: string;
    venue_stars: number | null; venue_review: string | null; venue_rated_at: string | null;
    artist_stars: number | null; artist_review: string | null; artist_rated_at: string | null;
  }
): Promise<RatingView> {
  const revealed = !!(row.venue_rated_at && row.artist_rated_at);
  const { data: venueProfile } = await service
    .from("venue_profiles")
    .select("venue_name, photo_url")
    .eq("id", row.venue_profile_id)
    .maybeSingle();

  return {
    id: row.id,
    venue_profile_id: row.venue_profile_id,
    artist_user_id: row.artist_user_id,
    revealed,
    my_stars: row.artist_stars ?? 0,
    my_review: row.artist_review,
    their_stars: revealed ? row.venue_stars : null,
    their_review: revealed ? row.venue_review : null,
    counterpart_name: (venueProfile?.venue_name as string | null) ?? "A venue",
    counterpart_photo_url: (venueProfile?.photo_url as string | null) ?? null,
  };
}

// Every relationship this artist has rated (their half always present, the
// venue's half once revealed) — powers the "Ratings you've given" section.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const { data: rows, error } = await service
    .from("venue_artist_ratings")
    .select("*")
    .eq("artist_user_id", user.id)
    .not("artist_rated_at", "is", null)
    .order("artist_rated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const shaped = await Promise.all((rows ?? []).map((r) => shapeRow(service, r)));
  return NextResponse.json({ ratings: shaped });
}

// Submit or edit the artist's half of a relationship. First submission
// requires qualifying_gig_id and passes it through validateQualifyingGig;
// edits (the row already exists) don't need it again.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { venue_profile_id, stars, review, qualifying_gig_id } = body;

  if (!venue_profile_id || typeof stars !== "number" || stars < 1 || stars > 5) {
    return NextResponse.json({ error: "venue_profile_id and stars (1-5) are required" }, { status: 400 });
  }

  const service = await createServiceClient();

  const { data: existing, error: existingError } = await service
    .from("venue_artist_ratings")
    .select("*")
    .eq("venue_profile_id", venue_profile_id)
    .eq("artist_user_id", user.id)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  if (!existing) {
    if (!qualifying_gig_id) {
      return NextResponse.json({ error: "qualifying_gig_id is required for a first rating" }, { status: 400 });
    }
    const validation = await validateQualifyingGig(service, {
      gigId: qualifying_gig_id,
      venueProfileId: venue_profile_id,
      artistUserId: user.id,
    });
    if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 403 });
  }

  const wasRevealedBefore = !!(existing?.venue_rated_at && existing?.artist_rated_at);
  const now = new Date().toISOString();

  const { data: saved, error: saveError } = await service
    .from("venue_artist_ratings")
    .upsert(
      {
        venue_profile_id,
        artist_user_id: user.id,
        ...(existing ? {} : { qualifying_gig_id }),
        artist_stars: stars,
        artist_review: review ?? null,
        artist_rated_at: now,
      },
      { onConflict: "venue_profile_id,artist_user_id" }
    )
    .select()
    .single();

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  const nowRevealed = !!(saved.venue_rated_at && saved.artist_rated_at);
  if (nowRevealed && !wasRevealedBefore) {
    try {
      await sendRatingRevealedEmail(service, saved, "artist");
    } catch (err) {
      console.error("POST /api/ratings: failed to send reveal email", err);
    }
  }

  return NextResponse.json(await shapeRow(service, saved));
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/ratings/
git commit -m "feat: add artist-side rating API routes"
```

---

## Task 6: Venue rating API routes

**Files:**
- Create: `app/api/venue/ratings/pending/route.ts`
- Create: `app/api/venue/ratings/route.ts`

Mirror of Task 5, from the venue's side. The only real difference: a venue's identity is `venue_profiles.id`, looked up from their own session first (same pattern used by `app/api/venue-profile/route.ts`), before any of the shared eligibility helpers can be called.

- [ ] **Step 1: Write the pending-list route**

```typescript
// app/api/venue/ratings/pending/route.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getVenuePendingRelationships } from "@/lib/ratings/eligibility";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: venueProfile } = await supabase
    .from("venue_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!venueProfile) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const service = await createServiceClient();
  try {
    const pending = await getVenuePendingRelationships(service, venueProfile.id as string);
    return NextResponse.json({ pending });
  } catch (err) {
    console.error("GET /api/venue/ratings/pending failed", err);
    return NextResponse.json({ error: "Failed to load pending ratings" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the GET/POST route**

```typescript
// app/api/venue/ratings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { validateQualifyingGig } from "@/lib/ratings/eligibility";
import { sendRatingRevealedEmail } from "@/lib/email/rating-notifications";
import { RatingView } from "@/types";

async function shapeRow(
  service: SupabaseClient,
  row: {
    id: string; venue_profile_id: string; artist_user_id: string;
    venue_stars: number | null; venue_review: string | null; venue_rated_at: string | null;
    artist_stars: number | null; artist_review: string | null; artist_rated_at: string | null;
  }
): Promise<RatingView> {
  const revealed = !!(row.venue_rated_at && row.artist_rated_at);
  const { data: artistProfile } = await service
    .from("artist_profiles")
    .select("display_name, photo_url")
    .eq("user_id", row.artist_user_id)
    .maybeSingle();

  return {
    id: row.id,
    venue_profile_id: row.venue_profile_id,
    artist_user_id: row.artist_user_id,
    revealed,
    my_stars: row.venue_stars ?? 0,
    my_review: row.venue_review,
    their_stars: revealed ? row.artist_stars : null,
    their_review: revealed ? row.artist_review : null,
    counterpart_name: (artistProfile?.display_name as string | null) ?? "An artist",
    counterpart_photo_url: (artistProfile?.photo_url as string | null) ?? null,
  };
}

async function getOwnVenueProfileId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("venue_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const venueProfileId = await getOwnVenueProfileId(supabase, user.id);
  if (!venueProfileId) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const service = await createServiceClient();
  const { data: rows, error } = await service
    .from("venue_artist_ratings")
    .select("*")
    .eq("venue_profile_id", venueProfileId)
    .not("venue_rated_at", "is", null)
    .order("venue_rated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const shaped = await Promise.all((rows ?? []).map((r) => shapeRow(service, r)));
  return NextResponse.json({ ratings: shaped });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const venueProfileId = await getOwnVenueProfileId(supabase, user.id);
  if (!venueProfileId) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { artist_user_id, stars, review, qualifying_gig_id } = body;

  if (!artist_user_id || typeof stars !== "number" || stars < 1 || stars > 5) {
    return NextResponse.json({ error: "artist_user_id and stars (1-5) are required" }, { status: 400 });
  }

  const service = await createServiceClient();

  const { data: existing, error: existingError } = await service
    .from("venue_artist_ratings")
    .select("*")
    .eq("venue_profile_id", venueProfileId)
    .eq("artist_user_id", artist_user_id)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  if (!existing) {
    if (!qualifying_gig_id) {
      return NextResponse.json({ error: "qualifying_gig_id is required for a first rating" }, { status: 400 });
    }
    const validation = await validateQualifyingGig(service, {
      gigId: qualifying_gig_id,
      venueProfileId,
      artistUserId: artist_user_id,
    });
    if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 403 });
  }

  const wasRevealedBefore = !!(existing?.venue_rated_at && existing?.artist_rated_at);
  const now = new Date().toISOString();

  const { data: saved, error: saveError } = await service
    .from("venue_artist_ratings")
    .upsert(
      {
        venue_profile_id: venueProfileId,
        artist_user_id,
        ...(existing ? {} : { qualifying_gig_id }),
        venue_stars: stars,
        venue_review: review ?? null,
        venue_rated_at: now,
      },
      { onConflict: "venue_profile_id,artist_user_id" }
    )
    .select()
    .single();

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  const nowRevealed = !!(saved.venue_rated_at && saved.artist_rated_at);
  if (nowRevealed && !wasRevealedBefore) {
    try {
      await sendRatingRevealedEmail(service, saved, "venue");
    } catch (err) {
      console.error("POST /api/venue/ratings: failed to send reveal email", err);
    }
  }

  return NextResponse.json(await shapeRow(service, saved));
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/venue/ratings/
git commit -m "feat: add venue-side rating API routes"
```

---

## Task 7: Report endpoint

**Files:**
- Create: `app/api/ratings/[id]/report/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/ratings/[id]/report/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { Resend } from "resend";

async function notifyTaylorOfReport(
  ratingId: string,
  reporterUserId: string,
  reason: string | null
): Promise<void> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail) {
    console.error("report route: Resend not configured, skipping notification email");
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `StageReach <${fromEmail}>`,
    to: fromEmail,
    subject: "A rating was reported on StageReach",
    text: `Rating ${ratingId} was reported by user ${reporterUserId}.\n\nReason: ${reason ?? "(none given)"}\n\nLook it up directly in Supabase (venue_artist_ratings table) to review and remove if warranted.`,
  });
  if (error) console.error("report route: failed to send notification email", error);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 2000) : null;

  const service = await createServiceClient();
  const { data: rating, error } = await service
    .from("venue_artist_ratings")
    .select("id, venue_profile_id, artist_user_id, venue_rated_at, artist_rated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rating) return NextResponse.json({ error: "Rating not found" }, { status: 404 });

  // Only reportable once revealed — the UI only ever shows a Report link
  // after reveal, and the server enforces the same rule so a rating can't
  // be reported before the reporter has actually seen it.
  const revealed = !!(rating.venue_rated_at && rating.artist_rated_at);
  if (!revealed) return NextResponse.json({ error: "This rating hasn't been revealed yet" }, { status: 403 });

  const isArtistParty = rating.artist_user_id === user.id;
  let isVenueParty = false;
  if (!isArtistParty) {
    const { data: venueProfile } = await service
      .from("venue_profiles")
      .select("user_id")
      .eq("id", rating.venue_profile_id)
      .maybeSingle();
    isVenueParty = venueProfile?.user_id === user.id;
  }
  if (!isArtistParty && !isVenueParty) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error: insertError } = await service
    .from("venue_artist_rating_reports")
    .insert({ rating_id: rating.id, reporter_user_id: user.id, reason });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  try {
    await notifyTaylorOfReport(rating.id as string, user.id, reason);
  } catch (err) {
    console.error("report route: failed to send notification email", err);
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/ratings/\[id\]/report/route.ts
git commit -m "feat: add rating report endpoint"
```

---

## Task 8: Public rating read routes

**Files:**
- Create: `app/api/public/venues/[id]/ratings/route.ts`
- Create: `app/api/public/artists/[id]/ratings/route.ts`

No login required — these power the new public venue page and the ratings section on the existing artist public profile. Both live under `/api/public/` specifically so `proxy.ts` (Task 10) can allow them through with one simple prefix check instead of a route-specific pattern.

- [ ] **Step 1: Write the venue-ratings public route**

```typescript
// app/api/public/venues/[id]/ratings/route.ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { PublicRatingsResponse } from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = await createServiceClient();

  const { data: rows, error } = await service
    .from("venue_artist_ratings")
    .select("artist_user_id, artist_stars, artist_review")
    .eq("venue_profile_id", id)
    .not("venue_rated_at", "is", null)
    .not("artist_rated_at", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const artistIds = (rows ?? []).map((r) => r.artist_user_id as string);
  const { data: artists } = await service
    .from("artist_profiles")
    .select("user_id, display_name, photo_url")
    .in("user_id", artistIds.length > 0 ? artistIds : [""]);
  const artistById = new Map((artists ?? []).map((a) => [a.user_id as string, a]));

  const reviews = (rows ?? []).map((r) => {
    const artist = artistById.get(r.artist_user_id as string);
    return {
      reviewer_name: (artist?.display_name as string | null) ?? "Artist",
      reviewer_photo_url: (artist?.photo_url as string | null) ?? null,
      stars: r.artist_stars as number,
      review: r.artist_review as string | null,
    };
  });

  const count = reviews.length;
  const average = count > 0 ? reviews.reduce((sum, r) => sum + r.stars, 0) / count : null;

  const response: PublicRatingsResponse = { average, count, reviews };
  return NextResponse.json(response);
}
```

- [ ] **Step 2: Write the artist-ratings public route**

```typescript
// app/api/public/artists/[id]/ratings/route.ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { PublicRatingsResponse } from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = await createServiceClient();

  const { data: rows, error } = await service
    .from("venue_artist_ratings")
    .select("venue_profile_id, venue_stars, venue_review")
    .eq("artist_user_id", id)
    .not("venue_rated_at", "is", null)
    .not("artist_rated_at", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const venueIds = (rows ?? []).map((r) => r.venue_profile_id as string);
  const { data: venues } = await service
    .from("venue_profiles")
    .select("id, venue_name, photo_url")
    .in("id", venueIds.length > 0 ? venueIds : [""]);
  const venueById = new Map((venues ?? []).map((v) => [v.id as string, v]));

  const reviews = (rows ?? []).map((r) => {
    const venue = venueById.get(r.venue_profile_id as string);
    return {
      reviewer_name: (venue?.venue_name as string | null) ?? "Venue",
      reviewer_photo_url: (venue?.photo_url as string | null) ?? null,
      stars: r.venue_stars as number,
      review: r.venue_review as string | null,
    };
  });

  const count = reviews.length;
  const average = count > 0 ? reviews.reduce((sum, r) => sum + r.stars, 0) / count : null;

  const response: PublicRatingsResponse = { average, count, reviews };
  return NextResponse.json(response);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/public/
git commit -m "feat: add public rating read endpoints"
```

---

## Task 9: Gig completion trigger

**Files:**
- Modify: `app/api/gigs/[id]/route.ts`

This is the task that needs the most care in review — see "Before you start" at the top of this plan. The existing PATCH handler must keep using the ordinary session client (`createClient()`) for the actual gig update — that's what enforces an artist can only update their own gigs via the `.eq("user_id", user.id)` filter. The NEW logic added here (checking `venue_artist_ratings` and sending the notification) must use `createServiceClient()` instead, because `venue_artist_ratings` has no client-facing RLS policies at all — reading it through the ordinary client wouldn't error, it would just silently return nothing, making the whole re-fire guard in `maybeSendNewGigToRateEmails` a no-op.

- [ ] **Step 1: Read the current file**

Run: `cat app/api/gigs/[id]/route.ts`
(Confirms it's still the version already read during planning — a single `PATCH` and `DELETE` handler, `PATCH` using `createClient()` with an `.eq("user_id", user.id)` filter.)

- [ ] **Step 2: Modify the PATCH handler**

Replace the full contents of `app/api/gigs/[id]/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { maybeSendNewGigToRateEmails } from "@/lib/email/rating-notifications";

// PATCH /api/gigs/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // Read the prior status before the update — the notification below only
  // fires on an actual transition INTO "completed", not on every PATCH
  // that happens to include status: "completed" again.
  const { data: before } = await supabase
    .from("gigs")
    .select("status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("gigs")
    .update(body)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
}

// DELETE /api/gigs/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("gigs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/gigs/\[id\]/route.ts
git commit -m "feat: trigger new-gig-to-rate emails when a linked gig completes"
```

---

## Task 10: Middleware update

**Files:**
- Modify: `proxy.ts`

**Do not use a blanket `pathname.startsWith("/venues/")`** — see "Before you start." Use scoped prefixes only.

- [ ] **Step 1: Add the two new public-route prefixes**

In `proxy.ts`, find the `isPublicRoute` assignment:

```typescript
  const isPublicRoute =
    pathname.startsWith("/profile/") ||
    pathname === "/api/calendar/ics" ||
    pathname === "/api/auth/validate-code" ||
    pathname === "/api/auth/confirm" ||
    pathname === "/signup" ||
    pathname === "/venues" ||
    pathname === "/venues/signup";
```

Replace it with:

```typescript
  const isPublicRoute =
    pathname.startsWith("/profile/") ||
    pathname.startsWith("/venues/profile/") ||
    pathname.startsWith("/api/public/") ||
    pathname === "/api/calendar/ics" ||
    pathname === "/api/auth/validate-code" ||
    pathname === "/api/auth/confirm" ||
    pathname === "/signup" ||
    pathname === "/venues" ||
    pathname === "/venues/signup";
```

Note: `/venues/profile/` does NOT match the existing private `/venues/import` or `/venues/[id]` routes — those don't share this prefix. Only the new `/venues/profile/[id]` page and its children match.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "feat: allow the new public ratings routes through middleware"
```

---

## Task 11: Public venue profile page

**Files:**
- Create: `app/venues/profile/[id]/page.tsx`

Mirrors the structure of the existing public artist page (`app/profile/[id]/page.tsx`) — a server component reading directly from Supabase via the service-role client (same reasoning: this page must work for logged-out visitors, so it can't rely on the caller's own RLS session), plus a client-rendered ratings section fetched from the new public endpoint.

**Reminder: this file lives at `app/venues/profile/[id]/page.tsx`, NOT `app/venues/[id]/page.tsx`** — the latter already exists as a different, private page.

- [ ] **Step 1: Check the existing private `/venues/[id]` page isn't accidentally touched**

Run: `git status --short app/`
Expected: no changes to `app/(protected)/venues/[id]/page.tsx` — this task only creates a new file elsewhere.

- [ ] **Step 2: Write the page**

```typescript
// app/venues/profile/[id]/page.tsx
import { createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { VenueProfile } from "@/types";
import RatingsSection from "@/components/ratings/RatingsSection";

export default async function PublicVenueProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServiceClient();

  const { data: profile } = await supabase
    .from("venue_profiles")
    .select("*")
    .eq("id", id)
    .not("venue_name", "is", null)
    .single();

  if (!profile) notFound();

  const p = profile as VenueProfile;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-start gap-4 mb-6">
          {p.photo_url ? (
            <img src={p.photo_url} alt={p.venue_name ?? ""} className="w-16 h-16 rounded-xl object-cover shrink-0" />
          ) : (
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-xl font-bold shrink-0"
              style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
            >
              {(p.venue_name ?? "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "#F4E8D2" }}>{p.venue_name}</h1>
            <p className="text-sm" style={{ color: "#9a9591" }}>
              {[p.venue_type, p.city].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>

        {p.description && (
          <p className="text-sm mb-6" style={{ color: "#F4E8D2" }}>{p.description}</p>
        )}

        {p.genres.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {p.genres.map((g) => (
              <span
                key={g}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "rgba(212,166,79,0.12)", color: "#D4A64F" }}
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {p.stage_equipment && (
          <div className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: "#5e5c58" }}>
              Stage & Equipment
            </h2>
            <p className="text-sm" style={{ color: "#F4E8D2" }}>{p.stage_equipment}</p>
          </div>
        )}

        <RatingsSection endpoint={`/api/public/venues/${id}/ratings`} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the shared ratings-display component**

This is used by both the new venue page and the existing artist page (Task 12) — one component, two endpoints.

```typescript
// components/ratings/RatingsSection.tsx
"use client";

import { useState, useEffect } from "react";
import { PublicRatingsResponse } from "@/types";

export default function RatingsSection({ endpoint }: { endpoint: string }) {
  const [data, setData] = useState<PublicRatingsResponse | null>(null);

  useEffect(() => {
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [endpoint]);

  if (!data || data.count === 0) return null;

  return (
    <div className="mt-8 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
        Ratings
      </h2>
      <p className="text-sm mb-4" style={{ color: "#D4A64F" }}>
        {"★".repeat(Math.round(data.average ?? 0))}
        {"☆".repeat(5 - Math.round(data.average ?? 0))}{" "}
        {data.average?.toFixed(1)} · {data.count} rating{data.count !== 1 ? "s" : ""}
      </p>
      <div className="space-y-3">
        {data.reviews.map((r, i) => (
          <div key={i} className="rounded-lg p-3" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center gap-2 mb-1">
              {r.reviewer_photo_url ? (
                <img src={r.reviewer_photo_url} alt={r.reviewer_name} className="w-6 h-6 rounded-full object-cover" />
              ) : (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
                >
                  {r.reviewer_name.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm font-medium" style={{ color: "#F4E8D2" }}>{r.reviewer_name}</span>
              <span className="text-xs" style={{ color: "#D4A64F" }}>
                {"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}
              </span>
            </div>
            {r.review && <p className="text-sm" style={{ color: "#9a9591" }}>{r.review}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/venues/profile/ components/ratings/RatingsSection.tsx
git commit -m "feat: add public venue profile page with ratings section"
```

---

## Task 12: Artist public profile — add ratings section

**Files:**
- Modify: `app/profile/[id]/page.tsx`

- [ ] **Step 1: Import the shared component and render it**

Add the import near the top of `app/profile/[id]/page.tsx`:

```typescript
import RatingsSection from "@/components/ratings/RatingsSection";
```

Find the end of the page's returned JSX (after the existing bio/social/packages/videos sections, before the closing tags of the outer container) and add:

```typescript
        <RatingsSection endpoint={`/api/public/artists/${id}/ratings`} />
```

(The exact insertion point depends on the current JSX structure — place it as the last section before the page's closing container tag, consistent with how the new public venue page in Task 11 places it last.)

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual visual check**

Run the dev server and visit `/profile/<any real artist id>` — confirm the page still renders correctly and the Ratings section simply doesn't appear (since `RatingsSection` renders `null` when `count === 0`, which is expected before any ratings exist yet).

- [ ] **Step 4: Commit**

```bash
git add app/profile/\[id\]/page.tsx
git commit -m "feat: show ratings section on artist public profile"
```

---

## Task 13: Artist pending-ratings page

**Files:**
- Create: `app/ratings/page.tsx`
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 1: Write the page**

```typescript
// app/ratings/page.tsx
"use client";

import { useState, useEffect } from "react";
import { PendingRating, RatingView } from "@/types";

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="text-xl leading-none"
          style={{ color: n <= value ? "#D4A64F" : "#5e5c58" }}
        >
          {n <= value ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

function PendingRow({ item, onSubmitted }: { item: PendingRating; onSubmitted: () => void }) {
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (stars < 1) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_profile_id: item.venue_profile_id,
        stars,
        review: review.trim() || undefined,
        qualifying_gig_id: item.qualifying_gig_id,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onSubmitted();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't submit — please try again.");
    }
  }

  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-3 mb-3">
        {item.counterpart_photo_url ? (
          <img src={item.counterpart_photo_url} alt={item.counterpart_name} className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}>
            {item.counterpart_name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <div className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>{item.counterpart_name}</div>
          <div className="text-xs" style={{ color: "#5e5c58" }}>Gig on {item.qualifying_gig_date}</div>
        </div>
      </div>
      <StarPicker value={stars} onChange={setStars} />
      <textarea
        rows={2}
        placeholder="Optional review"
        value={review}
        onChange={(e) => setReview(e.target.value)}
        className="w-full mt-2 rounded-lg px-3 py-2 text-sm outline-none resize-none"
        style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2" }}
      />
      {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
      <button
        onClick={submit}
        disabled={stars < 1 || saving}
        className="mt-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
        style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: stars < 1 || saving ? 0.6 : 1 }}
      >
        {saving ? "Submitting…" : "Submit Rating"}
      </button>
    </div>
  );
}

export default function RatingsPage() {
  const [pending, setPending] = useState<PendingRating[]>([]);
  const [given, setGiven] = useState<RatingView[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [pendingRes, givenRes] = await Promise.all([
      fetch("/api/ratings/pending").then((r) => (r.ok ? r.json() : { pending: [] })),
      fetch("/api/ratings").then((r) => (r.ok ? r.json() : { ratings: [] })),
    ]);
    setPending(pendingRes.pending ?? []);
    setGiven(givenRes.ratings ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) return null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="text-xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Ratings</h1>

      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
        Awaiting your rating {pending.length > 0 && `(${pending.length})`}
      </h2>
      {pending.length === 0 ? (
        <p className="text-sm mb-8" style={{ color: "#5e5c58" }}>Nothing to rate right now.</p>
      ) : (
        <div className="space-y-3 mb-8">
          {pending.map((item) => (
            <PendingRow key={item.venue_profile_id} item={item} onSubmitted={load} />
          ))}
        </div>
      )}

      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
        Ratings you&apos;ve given
      </h2>
      {given.length === 0 ? (
        <p className="text-sm" style={{ color: "#5e5c58" }}>You haven&apos;t rated anyone yet.</p>
      ) : (
        <div className="space-y-3">
          {given.map((r) => (
            <div key={r.id} className="rounded-xl p-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="text-sm font-semibold mb-1" style={{ color: "#F4E8D2" }}>{r.counterpart_name}</div>
              <p className="text-xs" style={{ color: "#D4A64F" }}>
                Your rating: {"★".repeat(r.my_stars)}{"☆".repeat(5 - r.my_stars)}
              </p>
              {r.revealed ? (
                <p className="text-xs mt-1" style={{ color: "#9a9591" }}>
                  Their rating: {"★".repeat(r.their_stars ?? 0)}{"☆".repeat(5 - (r.their_stars ?? 0))}
                </p>
              ) : (
                <p className="text-xs mt-1" style={{ color: "#5e5c58" }}>Awaiting their response</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add "Ratings" to the Sidebar**

In `components/layout/Sidebar.tsx`, add a new entry to `mainLinks` (after `"Invoices"`):

```typescript
  { href: "/invoices",   label: "Invoices",          icon: "$", badge: null, comingSoon: false },
  { href: "/ratings",    label: "Ratings",           icon: "★", badge: null, comingSoon: false },
```

The `badge` field already exists in the `mainLinks` type shape and is already rendered conditionally (see the existing `{link.badge && (...)}` block) — leave it `null` for now. A live pending-count badge is a reasonable follow-up but isn't required for this page to work; wiring live state into a link array defined as a static const would need its own small refactor, better scoped as a fast-follow than bundled into this already-large plan.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/ratings/ components/layout/Sidebar.tsx
git commit -m "feat: add artist pending-ratings page and nav link"
```

---

## Task 14: Venue pending-ratings page

**Files:**
- Create: `app/venue/ratings/page.tsx`
- Modify: `components/venue/VenueNav.tsx`

Mirror of Task 13, using the venue-side endpoints.

- [ ] **Step 1: Write the page**

```typescript
// app/venue/ratings/page.tsx
"use client";

import { useState, useEffect } from "react";
import VenueNav from "@/components/venue/VenueNav";
import { PendingRating, RatingView } from "@/types";

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="text-xl leading-none"
          style={{ color: n <= value ? "#D4A64F" : "#5e5c58" }}
        >
          {n <= value ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

function PendingRow({ item, onSubmitted }: { item: PendingRating; onSubmitted: () => void }) {
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (stars < 1) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/venue/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artist_user_id: item.artist_user_id,
        stars,
        review: review.trim() || undefined,
        qualifying_gig_id: item.qualifying_gig_id,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onSubmitted();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't submit — please try again.");
    }
  }

  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-3 mb-3">
        {item.counterpart_photo_url ? (
          <img src={item.counterpart_photo_url} alt={item.counterpart_name} className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}>
            {item.counterpart_name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <div className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>{item.counterpart_name}</div>
          <div className="text-xs" style={{ color: "#5e5c58" }}>Gig on {item.qualifying_gig_date}</div>
        </div>
      </div>
      <StarPicker value={stars} onChange={setStars} />
      <textarea
        rows={2}
        placeholder="Optional review"
        value={review}
        onChange={(e) => setReview(e.target.value)}
        className="w-full mt-2 rounded-lg px-3 py-2 text-sm outline-none resize-none"
        style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2" }}
      />
      {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
      <button
        onClick={submit}
        disabled={stars < 1 || saving}
        className="mt-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
        style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: stars < 1 || saving ? 0.6 : 1 }}
      >
        {saving ? "Submitting…" : "Submit Rating"}
      </button>
    </div>
  );
}

export default function VenueRatingsPage() {
  const [pending, setPending] = useState<PendingRating[]>([]);
  const [given, setGiven] = useState<RatingView[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [pendingRes, givenRes] = await Promise.all([
      fetch("/api/venue/ratings/pending").then((r) => (r.ok ? r.json() : { pending: [] })),
      fetch("/api/venue/ratings").then((r) => (r.ok ? r.json() : { ratings: [] })),
    ]);
    setPending(pendingRes.pending ?? []);
    setGiven(givenRes.ratings ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
      <VenueNav />
      {!loading && (
        <div className="max-w-2xl mx-auto px-6 py-10">
          <h1 className="text-xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Ratings</h1>

          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
            Awaiting your rating {pending.length > 0 && `(${pending.length})`}
          </h2>
          {pending.length === 0 ? (
            <p className="text-sm mb-8" style={{ color: "#5e5c58" }}>Nothing to rate right now.</p>
          ) : (
            <div className="space-y-3 mb-8">
              {pending.map((item) => (
                <PendingRow key={item.artist_user_id} item={item} onSubmitted={load} />
              ))}
            </div>
          )}

          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
            Ratings you&apos;ve given
          </h2>
          {given.length === 0 ? (
            <p className="text-sm" style={{ color: "#5e5c58" }}>You haven&apos;t rated anyone yet.</p>
          ) : (
            <div className="space-y-3">
              {given.map((r) => (
                <div key={r.id} className="rounded-xl p-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-sm font-semibold mb-1" style={{ color: "#F4E8D2" }}>{r.counterpart_name}</div>
                  <p className="text-xs" style={{ color: "#D4A64F" }}>
                    Your rating: {"★".repeat(r.my_stars)}{"☆".repeat(5 - r.my_stars)}
                  </p>
                  {r.revealed ? (
                    <p className="text-xs mt-1" style={{ color: "#9a9591" }}>
                      Their rating: {"★".repeat(r.their_stars ?? 0)}{"☆".repeat(5 - (r.their_stars ?? 0))}
                    </p>
                  ) : (
                    <p className="text-xs mt-1" style={{ color: "#5e5c58" }}>Awaiting their response</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add "Ratings" to VenueNav**

In `components/venue/VenueNav.tsx`, update `links`:

```typescript
const links = [
  { href: "/venue/profile", label: "My Profile" },
  { href: "/venue/discover", label: "Discover Artists" },
  { href: "/venue/ratings", label: "Ratings" },
];
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/venue/ratings/ components/venue/VenueNav.tsx
git commit -m "feat: add venue pending-ratings page and nav link"
```

---

## Task 15: Discover Artists — rating badge

**Files:**
- Modify: `app/api/venues/discover-artists/route.ts`
- Modify: `app/venue/discover/page.tsx`

Adds `avg_rating`/`rating_count` to each artist result, computed from revealed ratings only.

- [ ] **Step 1: Extend the endpoint's `ArtistResult` type and final loop**

In `app/api/venues/discover-artists/route.ts`, update the `ArtistResult` type:

```typescript
type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
  avg_rating: number | null;
  rating_count: number;
};
```

After the existing `artists` fetch (the block using `artist_profiles` and building `matchingGenre`/`other`), add a ratings lookup right before the `for (const artist of artists ?? [])` loop:

```typescript
  const artistUserIdsForRatings = (artists ?? []).map((a) => a.user_id as string);
  const { data: ratingRows } = await supabase
    .from("venue_artist_ratings")
    .select("artist_user_id, venue_stars")
    .in("artist_user_id", artistUserIdsForRatings.length > 0 ? artistUserIdsForRatings : [""])
    .not("venue_rated_at", "is", null)
    .not("artist_rated_at", "is", null);

  const ratingsByArtist = new Map<string, number[]>();
  for (const row of ratingRows ?? []) {
    const list = ratingsByArtist.get(row.artist_user_id as string) ?? [];
    list.push(row.venue_stars as number);
    ratingsByArtist.set(row.artist_user_id as string, list);
  }
```

Note: this uses `supabase` (the venue's own RLS session), not the `service` client — `venue_artist_ratings` has no client-facing policies at all, so this read must actually go through `service` instead. Correct it to:

```typescript
  const { data: ratingRows } = await service
    .from("venue_artist_ratings")
    ...
```

Then, inside the existing `for (const artist of artists ?? [])` loop, where `result` is constructed, add the two new fields:

```typescript
    const stars = ratingsByArtist.get(artist.user_id) ?? [];
    const result: ArtistResult = {
      user_id: artist.user_id,
      display_name: artist.display_name,
      genres: result_genres, // keep existing line as-is; this is illustrative only
      photo_url: artist.photo_url,
      avg_rating: stars.length > 0 ? stars.reduce((a, b) => a + b, 0) / stars.length : null,
      rating_count: stars.length,
    };
```

(Adjust to fit the exact existing variable names in that block — the two new fields are the only actual change; everything else in the object literal stays as it already is.)

- [ ] **Step 2: Show the badge in `app/venue/discover/page.tsx`**

In the `ArtistResult` type at the top of the file, add the same two fields:

```typescript
type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
  avg_rating: number | null;
  rating_count: number;
};
```

In the `ArtistCard` component, add a rating line — only rendered when `rating_count > 0`, right after the existing genres `<div>`:

```typescript
      {artist.rating_count > 0 && (
        <div className="text-xs mt-0.5" style={{ color: "#D4A64F" }}>
          {"★".repeat(Math.round(artist.avg_rating ?? 0))}{"☆".repeat(5 - Math.round(artist.avg_rating ?? 0))}{" "}
          {artist.avg_rating?.toFixed(1)} ({artist.rating_count})
        </div>
      )}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/venues/discover-artists/route.ts app/venue/discover/page.tsx
git commit -m "feat: show rating badge on Discover Artists results"
```

---

## Task 16: Discover Venues — rating badge

**Files:**
- Modify: `app/api/venues/discover/route.ts`
- Modify: `components/discover/DiscoverView.tsx`

Same idea as Task 15, reversed — a venue only ever has a rating to show once it's linked (`venue_profile_id` present), since ratings are keyed by `venue_profile_id`, not by the raw external search result.

- [ ] **Step 1: Extend the endpoint**

In `app/api/venues/discover/route.ts`, add `avg_rating: number | null` and `rating_count: number` to the `DiscoverResult` type.

In `applyStageReachMatches` (the function that already tags each result with `venue_profile_id`), extend it to also attach ratings, right after computing `tagged`:

```typescript
function applyStageReachMatches(
  results: DiscoverResult[],
  profileByKey: Map<string, string>,
  ratingsByProfileId: Map<string, { avg: number; count: number }>
): DiscoverResult[] {
  if (results.length === 0 || profileByKey.size === 0) return results;

  const tagged = results.map((r) => {
    const venueProfileId = profileByKey.get(normalizeMatchKey(r.name, r.city)) ?? null;
    const rating = venueProfileId ? ratingsByProfileId.get(venueProfileId) : undefined;
    return {
      ...r,
      venue_profile_id: venueProfileId,
      avg_rating: rating?.avg ?? null,
      rating_count: rating?.count ?? 0,
    };
  });

  return tagged.sort((a, b) => {
    if (!!a.venue_profile_id === !!b.venue_profile_id) return 0;
    return a.venue_profile_id ? -1 : 1;
  });
}
```

Add a new helper (alongside the existing `fetchStageReachProfileMap`) that loads revealed ratings, aggregated per venue:

```typescript
async function fetchVenueRatingsMap(): Promise<Map<string, { avg: number; count: number }>> {
  const service = await createServiceClient();
  const { data: rows, error } = await service
    .from("venue_artist_ratings")
    .select("venue_profile_id, venue_stars")
    .not("venue_rated_at", "is", null)
    .not("artist_rated_at", "is", null);

  if (error) {
    console.error("fetchVenueRatingsMap: failed", error);
    return new Map();
  }

  const starsByProfile = new Map<string, number[]>();
  for (const row of rows ?? []) {
    const list = starsByProfile.get(row.venue_profile_id as string) ?? [];
    list.push(row.venue_stars as number);
    starsByProfile.set(row.venue_profile_id as string, list);
  }

  const result = new Map<string, { avg: number; count: number }>();
  for (const [profileId, stars] of starsByProfile) {
    result.set(profileId, { avg: stars.reduce((a, b) => a + b, 0) / stars.length, count: stars.length });
  }
  return result;
}
```

In the `GET` handler, kick this off alongside the existing `profileMapPromise` (same "no dependency on search results, run concurrently" reasoning already used there):

```typescript
  const profileMapPromise = fetchStageReachProfileMap();
  const ratingsMapPromise = fetchVenueRatingsMap();
```

And update both call sites of `applyStageReachMatches` to pass the resolved ratings map:

```typescript
    return NextResponse.json({ results: applyStageReachMatches(merged, await profileMapPromise, await ratingsMapPromise) });
```

```typescript
    return NextResponse.json({ results: applyStageReachMatches(results, await profileMapPromise, await ratingsMapPromise) });
```

Also update the three inline `DiscoverResult` object literals inside `searchWithGoogle`, `searchWithGeoapify`, and `searchWithOverpass` — each already sets `venue_profile_id: null`; add `avg_rating: null, rating_count: 0` alongside it in all three places (they're always overwritten by `applyStageReachMatches` when a match exists, same as `venue_profile_id` already is).

- [ ] **Step 2: Show the badge in `DiscoverView.tsx`**

Add the two fields to the local `DiscoverResult` type, then render a badge in the card — right after the existing "⭐ On StageReach" badge block, only when `rating_count > 0`:

```typescript
                          {venue.rating_count > 0 && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full self-start"
                              style={{ backgroundColor: "rgba(212,166,79,0.15)", color: "#D4A64F", border: "1px solid #D4A64F44" }}
                            >
                              {"★".repeat(Math.round(venue.avg_rating ?? 0))}{"☆".repeat(5 - Math.round(venue.avg_rating ?? 0))}{" "}
                              {venue.avg_rating?.toFixed(1)} ({venue.rating_count})
                            </span>
                          )}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/venues/discover/route.ts components/discover/DiscoverView.tsx
git commit -m "feat: show rating badge on Discover Venues results"
```

---

## Task 17: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md**

Add a new bullet to the Core Data Model list (after `venue_profiles`):

```markdown
  - venue_artist_ratings — double-blind mutual rating between a venue account and an artist, one row per relationship holding both sides' halves (venue_stars/venue_review/venue_rated_at, artist_stars/artist_review/artist_rated_at). "Revealed" (both halves visible to each other, and shown publicly) is computed at read time — true once both `*_rated_at` are set. No client-facing RLS policies; every read/write goes through a server route using the service-role client. A rating opportunity requires a completed gig at a venue linked to a real account (see `venues.venue_profile_id`), and is limited to one per relationship ever, not per gig.
```

Add a new "Mutual Ratings" paragraph to the Key Flows section, after the existing "Venue Accounts" paragraph:

```markdown
  Mutual Ratings — the third and final piece of the venue portal. Once an artist marks a gig `completed` at a venue linked to a real account (`venues.venue_profile_id` set), both sides can rate each other 1-5 stars with an optional written review, at `/ratings` (artist) or `/venue/ratings` (venue). Ratings are double-blind — neither side sees the other's half until both have submitted — and editable any time afterward, including post-reveal. Two emails keep the loop moving: one when a gig completes and a new rating becomes available (`PATCH /api/gigs/[id]` → `lib/email/rating-notifications.ts`), one when the second half is submitted and the relationship reveals. Revealed ratings show publicly on the artist's existing `/profile/[id]` page and a new public venue page at `/venues/profile/[id]` (distinct from the private `/venue/profile` and the existing private `/venues/[id]` pipeline-detail page — note the different path shapes), plus as a small badge on both Discover Venues and Discover Artists result cards. Either party can report a revealed rating; reports email Taylor directly rather than going through any in-app moderation UI.
```

- [ ] **Step 2: Append to CHANGELOG.md**

Add a new entry at the top (after the `# StageReach Changelog` header):

```markdown
## 2026-08-18
- [Feature] Mutual ratings — venues and artists can now rate each other 1-5 stars (plus an optional written review) once they've actually worked together (a completed, linked gig). Ratings stay hidden from the other side until both have submitted, then show publicly on profiles and search results.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document mutual ratings feature"
```

---

## Final verification (controller, not a subagent task)

Requires a running dev server and a real venue + artist session with an actual completed, linked gig between them — subagent workers won't have this. After all 17 tasks pass review:

1. Run `npx tsc --noEmit` and `npx eslint` across the whole project one final time.
2. Ask Taylor to run `supabase/migrations/018_venue_artist_ratings.sql` in the Supabase SQL Editor if not already applied.
3. Ask Taylor to do a live walkthrough: mark a real completed gig at a linked venue → confirm both "new gig to rate" emails arrive → submit the artist's rating (confirm it doesn't reveal yet) → submit the venue's rating → confirm the "revealed" email fires and both sides can now see each other's rating on `/ratings` and `/venue/ratings` → confirm the rating shows on the artist's `/profile/[id]` and the venue's new `/venues/profile/[id]` → confirm the rating badge appears on Discover Venues / Discover Artists results.
