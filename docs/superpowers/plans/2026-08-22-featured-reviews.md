# Featured Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an artist or venue pick up to 3 of their received reviews to feature at the top of their public profile, with the rest available behind a "Load more reviews" button.

**Architecture:** Two nullable rank columns on the existing `venue_artist_ratings` table record each party's picks. A shared server-side helper (`lib/ratings/featured.ts`) handles the validate-then-write logic once, reused by two new mirror PUT endpoints (one for artists, one for venues). The public ratings API routes sort featured rows first; the client component slices the already-fetched list into "first 3" and "the rest."

**Tech Stack:** Next.js App Router route handlers, Supabase (service-role client for all `venue_artist_ratings` access, matching the existing no-RLS pattern on this table), React client components.

**No automated test suite exists in this project** (confirmed in `CLAUDE.md`). Verification throughout is `npx tsc --noEmit`, `npx eslint`, and manual/live checks — steps below reflect that.

---

### Task 1: Migration and type updates

**Files:**
- Create: `supabase/migrations/020_featured_reviews.sql`
- Modify: `types/index.ts:234-262` (`VenueArtistRatingRow`, `RatingView`)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/020_featured_reviews.sql
alter table venue_artist_ratings
  add column featured_by_artist_rank smallint,
  add column featured_by_venue_rank smallint;

create unique index venue_artist_ratings_artist_featured_rank_idx
  on venue_artist_ratings (artist_user_id, featured_by_artist_rank)
  where featured_by_artist_rank is not null;

create unique index venue_artist_ratings_venue_featured_rank_idx
  on venue_artist_ratings (venue_profile_id, featured_by_venue_rank)
  where featured_by_venue_rank is not null;
```

No RLS changes — `venue_artist_ratings` already has RLS enabled with zero client-facing policies (all access goes through the service-role client). These new columns don't change that.

- [ ] **Step 2: Add the two new columns to `VenueArtistRatingRow`**

In `types/index.ts`, inside the `VenueArtistRatingRow` interface (currently lines 234-247), add after `artist_rated_at`:

```typescript
  featured_by_artist_rank: number | null;
  featured_by_venue_rank: number | null;
```

- [ ] **Step 3: Add a `featured` flag to `RatingView`**

In `types/index.ts`, inside the `RatingView` interface (currently lines 251-262), add after `their_review`:

```typescript
  featured: boolean;
```

This is the flag the *owner's own* private ratings view uses to show "★ Featured" vs "☆ Feature this review" — it's computed server-side from whichever rank column belongs to the caller (see Task 2).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: New errors only where `RatingView` object literals are missing the new `featured` field — this is expected until Task 2 fills it in. If you see errors anywhere else, stop and investigate before continuing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/020_featured_reviews.sql types/index.ts
git commit -m "feat: add featured-review columns and types"
```

- [ ] **Step 6: Run the migration**

This step is for Taylor, not the agent: after this task is merged, she needs to run `supabase/migrations/020_featured_reviews.sql` in the Supabase SQL Editor before the featured-reviews feature will actually work end-to-end. Flag this clearly when the plan completes — same as every other migration this project has shipped.

---

### Task 2: Shared write helper + two PUT endpoints

**Files:**
- Create: `lib/ratings/featured.ts`
- Create: `app/api/ratings/featured/route.ts`
- Create: `app/api/venue/ratings/featured/route.ts`
- Modify: `app/api/ratings/route.ts:9-36` (`shapeRow`)
- Modify: `app/api/venue/ratings/route.ts:9-36` (`shapeRow`)

**Context:** `venue_artist_ratings` has no client-facing RLS — every read/write here goes through `createServiceClient()` (see `lib/supabase/server.ts`). The validate-then-write algorithm below was reviewed once already at the spec stage and a real bug was caught and fixed there: clearing ranks must happen for the caller's **entire** current selection before writing new ranks, not just the ids being dropped, or a legitimate reorder (e.g. swapping rank 1 and rank 2) hits the partial unique index mid-write. Follow the two-step order exactly as written below.

- [ ] **Step 1: Write the shared helper**

```typescript
// lib/ratings/featured.ts
import { SupabaseClient } from "@supabase/supabase-js";

type FeaturedParty = "artist" | "venue";

const RANK_COLUMN: Record<FeaturedParty, "featured_by_artist_rank" | "featured_by_venue_rank"> = {
  artist: "featured_by_artist_rank",
  venue: "featured_by_venue_rank",
};

const OWNER_COLUMN: Record<FeaturedParty, "artist_user_id" | "venue_profile_id"> = {
  artist: "artist_user_id",
  venue: "venue_profile_id",
};

// Replaces the caller's entire featured-picks list in one call. `ratingIds`
// is ordered (most-featured first), max 3, and may be empty to clear all
// picks. Every id must belong to the caller and be revealed, or the whole
// request is rejected — nothing is partially applied on a validation failure.
export async function setFeaturedRatings(
  service: SupabaseClient,
  party: FeaturedParty,
  ownerId: string,
  ratingIds: string[]
): Promise<{ error: string } | { success: true }> {
  const rankColumn = RANK_COLUMN[party];
  const ownerColumn = OWNER_COLUMN[party];

  if (ratingIds.length > 3) {
    return { error: "You can feature at most 3 reviews" };
  }
  if (new Set(ratingIds).size !== ratingIds.length) {
    return { error: "That list has a duplicate review in it" };
  }

  if (ratingIds.length > 0) {
    const { data: rows, error } = await service
      .from("venue_artist_ratings")
      .select(`id, venue_rated_at, artist_rated_at, ${ownerColumn}`)
      .in("id", ratingIds);
    if (error) return { error: error.message };

    const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
    for (const id of ratingIds) {
      const row = byId.get(id) as Record<string, unknown> | undefined;
      if (!row) return { error: "One of these reviews no longer exists" };
      if (row[ownerColumn] !== ownerId) return { error: "You can only feature your own reviews" };
      const revealed = !!(row.venue_rated_at && row.artist_rated_at);
      if (!revealed) return { error: "You can only feature a review that's been revealed" };
    }
  }

  // Clear ALL of the caller's currently-ranked rows first — including ones
  // staying in the new selection — so the second step below never collides
  // with a still-live rank on the partial unique index. See Task 2's
  // context note for why this order matters.
  const { error: clearError } = await service
    .from("venue_artist_ratings")
    .update({ [rankColumn]: null })
    .eq(ownerColumn, ownerId)
    .not(rankColumn, "is", null);
  if (clearError) return { error: clearError.message };

  for (let i = 0; i < ratingIds.length; i++) {
    const { error: writeError } = await service
      .from("venue_artist_ratings")
      .update({ [rankColumn]: i + 1 })
      .eq("id", ratingIds[i]);
    if (writeError) return { error: writeError.message };
  }

  return { success: true };
}
```

- [ ] **Step 2: Write the artist PUT endpoint**

```typescript
// app/api/ratings/featured/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { setFeaturedRatings } from "@/lib/ratings/featured";

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const ratingIds = Array.isArray(body.ratingIds) ? body.ratingIds : null;
  if (!ratingIds || ratingIds.some((id: unknown) => typeof id !== "string")) {
    return NextResponse.json({ error: "ratingIds must be an array of strings" }, { status: 400 });
  }

  const service = await createServiceClient();
  const result = await setFeaturedRatings(service, "artist", user.id, ratingIds);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Write the venue PUT endpoint**

```typescript
// app/api/venue/ratings/featured/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { setFeaturedRatings } from "@/lib/ratings/featured";

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: venueProfile } = await supabase
    .from("venue_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!venueProfile) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const ratingIds = Array.isArray(body.ratingIds) ? body.ratingIds : null;
  if (!ratingIds || ratingIds.some((id: unknown) => typeof id !== "string")) {
    return NextResponse.json({ error: "ratingIds must be an array of strings" }, { status: 400 });
  }

  const service = await createServiceClient();
  const result = await setFeaturedRatings(service, "venue", venueProfile.id as string, ratingIds);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Wire `featured` into the artist's `shapeRow`**

In `app/api/ratings/route.ts`, the `shapeRow` function's `row` parameter type (lines 11-15) needs the two new columns added:

```typescript
  row: {
    id: string; venue_profile_id: string; artist_user_id: string;
    venue_stars: number | null; venue_review: string | null; venue_rated_at: string | null;
    artist_stars: number | null; artist_review: string | null; artist_rated_at: string | null;
    featured_by_artist_rank: number | null; featured_by_venue_rank: number | null;
  }
```

And in the returned object (lines 24-35), add before the closing brace:

```typescript
    featured: row.featured_by_artist_rank !== null,
```

(The artist's own private view cares about *their own* featuring choice, which lives in `featured_by_artist_rank` — not the venue's.)

- [ ] **Step 5: Wire `featured` into the venue's `shapeRow`**

Same change in `app/api/venue/ratings/route.ts`'s `shapeRow`: add the two new fields to the `row` parameter type, and add to the returned object:

```typescript
    featured: row.featured_by_venue_rank !== null,
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add lib/ratings/featured.ts app/api/ratings/featured/route.ts app/api/venue/ratings/featured/route.ts app/api/ratings/route.ts app/api/venue/ratings/route.ts
git commit -m "feat: add PUT endpoints for setting featured reviews"
```

---

### Task 3: Sort featured reviews first on the public routes

**Files:**
- Modify: `app/api/public/artists/[id]/ratings/route.ts`
- Modify: `app/api/public/venues/[id]/ratings/route.ts`

**Context:** No new field is added to `PublicRatingsResponse` — the order of the `reviews` array is the only signal the client needs (see Task 5). `Array.prototype.sort` is stable in Node/modern browsers, so rows without a rank keep their existing relative order after sorting — this is what makes "featured first, then everything else in existing order" work with a single sort call.

- [ ] **Step 1: Update the artist public ratings route**

In `app/api/public/artists/[id]/ratings/route.ts`, change the `.select(...)` on line 15 to also fetch the rank column:

```typescript
    .select("venue_profile_id, venue_stars, venue_review, featured_by_artist_rank")
```

Then, immediately after the `if (error) ...` check (after line 20), sort the rows before mapping them:

```typescript
  const sortedRows = [...(rows ?? [])].sort((a, b) => {
    const rankA = a.featured_by_artist_rank as number | null;
    const rankB = b.featured_by_artist_rank as number | null;
    if (rankA !== null && rankB !== null) return rankA - rankB;
    if (rankA !== null) return -1;
    if (rankB !== null) return 1;
    return 0;
  });
```

Then change every use of `rows` below this point (the `venueIds` map and the `reviews` map) to use `sortedRows` instead.

- [ ] **Step 2: Update the venue public ratings route**

Same change in `app/api/public/venues/[id]/ratings/route.ts`, using `featured_by_venue_rank` instead:

```typescript
    .select("artist_user_id, artist_stars, artist_review, featured_by_venue_rank")
```

```typescript
  const sortedRows = [...(rows ?? [])].sort((a, b) => {
    const rankA = a.featured_by_venue_rank as number | null;
    const rankB = b.featured_by_venue_rank as number | null;
    if (rankA !== null && rankB !== null) return rankA - rankB;
    if (rankA !== null) return -1;
    if (rankB !== null) return 1;
    return 0;
  });
```

Use `sortedRows` in place of `rows` for the `artistIds` map and the `reviews` map below.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/public/artists/[id]/ratings/route.ts app/api/public/venues/[id]/ratings/route.ts
git commit -m "feat: sort featured reviews first on public ratings routes"
```

---

### Task 4: Picking UI on both private ratings pages

**Files:**
- Modify: `app/(protected)/ratings/page.tsx`
- Modify: `app/venue/ratings/page.tsx`

**Context:** Both pages already duplicate a `GivenRow` component in full (this codebase's existing pattern for this feature — not something to refactor here, per the spec's Non-Goals). Add the same toggle to both, each pointed at its own PUT endpoint. `rating.id` and `rating.revealed` are already present on every `RatingView`; `rating.featured` was added in Task 2.

- [ ] **Step 1: Add a `toggleFeatured` handler to the artist ratings page**

In `app/(protected)/ratings/page.tsx`, inside `RatingsPage` (after the `load` function, currently ending around line 249), add:

```typescript
  async function toggleFeatured(ratingId: string): Promise<{ error: string | null }> {
    const currentlyFeatured = given.filter((r) => r.featured).map((r) => r.id);
    const isFeatured = currentlyFeatured.includes(ratingId);
    const next = isFeatured
      ? currentlyFeatured.filter((id) => id !== ratingId)
      : [...currentlyFeatured, ratingId];
    if (next.length > 3) {
      return { error: "Un-feature one first — you can only feature up to 3" };
    }
    const res = await fetch("/api/ratings/featured", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ratingIds: next }),
    });
    if (res.ok) {
      await load();
      return { error: null };
    }
    const data = await res.json().catch(() => ({}));
    return { error: data.error ?? "Couldn't update — please try again." };
  }
```

- [ ] **Step 2: Pass it down and update `GivenRow`'s props**

Change the `given.map(...)` call (currently around line 279) to pass the new handler:

```tsx
          {given.map((r) => (
            <GivenRow key={r.id} rating={r} onUpdated={load} onToggleFeatured={toggleFeatured} />
          ))}
```

Update `GivenRow`'s function signature (currently line 92) to accept it:

```typescript
function GivenRow({ rating, onUpdated, onToggleFeatured }: {
  rating: RatingView;
  onUpdated: () => void;
  onToggleFeatured: (ratingId: string) => Promise<{ error: string | null }>;
}) {
```

- [ ] **Step 3: Add local state and the toggle button inside `GivenRow`**

Add two new state variables near the existing report-related state (after line 103):

```typescript
  const [featuredSaving, setFeaturedSaving] = useState(false);
  const [featuredError, setFeaturedError] = useState("");
```

Add the button inside the `rating.revealed` block, right after the "Their rating" `<p>` (after line 188, before the closing `) : (` for the `revealed`/not-revealed conditional — i.e. as a sibling to that `<p>`, still inside the `rating.revealed ? (...)` branch):

```tsx
              <div className="mt-1">
                <button
                  onClick={async () => {
                    setFeaturedSaving(true);
                    setFeaturedError("");
                    const result = await onToggleFeatured(rating.id);
                    setFeaturedSaving(false);
                    if (result.error) setFeaturedError(result.error);
                  }}
                  disabled={featuredSaving}
                  className="text-xs"
                  style={{ color: rating.featured ? "#D4A64F" : "#5b9bd5", opacity: featuredSaving ? 0.6 : 1 }}
                >
                  {rating.featured ? "★ Featured" : "☆ Feature this review"}
                </button>
                {featuredError && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{featuredError}</p>}
              </div>
```

- [ ] **Step 4: Repeat steps 1-3 for the venue ratings page**

Same three changes in `app/venue/ratings/page.tsx`, with one difference: the fetch call in `toggleFeatured` posts to `/api/venue/ratings/featured` instead of `/api/ratings/featured`. Everything else (the handler shape, the prop wiring, the button JSX) is identical.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add "app/(protected)/ratings/page.tsx" "app/venue/ratings/page.tsx"
git commit -m "feat: add Feature this review toggle to ratings pages"
```

---

### Task 5: "Top 3 + Load more" on the public profile

**Files:**
- Modify: `components/ratings/RatingsSection.tsx`

- [ ] **Step 1: Add expand state and slice the reviews array**

In `components/ratings/RatingsSection.tsx`, add a new state variable after the existing `data` state (line 9):

```typescript
  const [expanded, setExpanded] = useState(false);
```

Replace the `data.reviews.map(...)` call (currently line 31) with a slice based on `expanded`:

```typescript
  const visibleReviews = expanded ? data.reviews : data.reviews.slice(0, 3);
```

Add this line right before the `return` (after line 18's early-return check), then change line 31 from `data.reviews.map((r, i) => (` to `visibleReviews.map((r, i) => (`.

- [ ] **Step 2: Add the "Load more reviews" button**

After the closing `</div>` of the `space-y-3` reviews container (currently line 54), add:

```tsx
      {!expanded && data.reviews.length > 3 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs mt-3"
          style={{ color: "#5b9bd5" }}
        >
          Load more reviews
        </button>
      )}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add components/ratings/RatingsSection.tsx
git commit -m "feat: show top 3 reviews with a load-more button on public profiles"
```

---

### Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md` (Mutual Ratings paragraph)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md**

In the "Mutual Ratings" paragraph of `CLAUDE.md`, add a sentence covering the new capability — describe that the reviewed party can now pick up to 3 favorite reviews to feature at the top of their public profile via a toggle on their existing ratings page, with the rest available behind a "Load more reviews" button, and that this is stored via `featured_by_artist_rank`/`featured_by_venue_rank` on `venue_artist_ratings` (migration `020_featured_reviews.sql`).

- [ ] **Step 2: Add a CHANGELOG entry**

Add a new dated entry at the top of `CHANGELOG.md` (plain language, matching the existing style):

```
## 2026-08-22 (featured reviews)
- [Feature] Artists and venues can now pick up to 3 of their favorite reviews to feature at the top of their public profile — everything else is one click away behind a "Load more reviews" button.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document featured reviews"
```

---

### Task 7: Manual verification

This task has no automated equivalent — no test suite exists in this project. Verify with a live dev server:

- [ ] Start the dev server and confirm it builds without errors.
- [ ] As an artist or venue with at least 4 revealed reviews (real or seeded directly in Supabase for this check), visit `/ratings` (or `/venue/ratings`) and confirm the "☆ Feature this review" / "★ Featured" toggle appears on each revealed review, and that clicking it updates immediately.
- [ ] Confirm featuring a 4th review while 3 are already featured shows the inline "Un-feature one first" message instead of silently succeeding.
- [ ] Visit that party's public profile (`/profile/[id]` or `/venues/profile/[id]`) and confirm the featured reviews appear first, in the order they were featured, and that a "Load more reviews" button appears and reveals the rest.
- [ ] For a party with 3 or fewer total revealed reviews, confirm no "Load more reviews" button appears.
- [ ] Confirm this whole flow requires the migration from Task 1 to have been run in Supabase first — if Taylor hasn't run it yet by the time this task starts, flag that clearly rather than proceeding on a stale schema.
