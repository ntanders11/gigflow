# Venue Accounts & Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let venues sign up for their own StageReach account — either claiming a venue that already exists in some artist's private pipeline, or creating a fresh listing — log in, and manage their own profile. Wherever that venue already shows up (an artist's pipeline, or a Discover Venues search), it now shows a "⭐ On StageReach" badge, and in Discover Venues, is always ranked first.

**Architecture:** A new `venue_profiles` table (separate from the existing per-artist `venues` pipeline rows) plus a nullable `venue_profile_id` link column added to `venues`. Venue signup creates a blank `venue_profiles` row immediately at account creation — this is what lets the app's auth middleware tell "a venue mid-signup" apart from "an artist mid-signup" everywhere else. A service-role-backed search/linking mechanism (same pattern the existing CSV import route already uses) lets a venue search across every artist's private pipeline data without RLS blocking it, while only ever exposing public-safe fields.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), TypeScript, React client components. No automated test suite exists in this project — verification is `npx tsc --noEmit` / `npx eslint`, applying migrations via the Supabase SQL Editor, and manual browser checks.

**Full design reference:** `docs/superpowers/specs/2026-08-13-venue-accounts-design.md` — read this first if anything below is ambiguous; it has the complete reasoning behind every decision (why open signup, why no ownership verification, why the linking sweep is scoped the way it is, etc).

---

### Task 1: Database migration — `venue_profiles` table + `venues.venue_profile_id` link

**Files:**
- Create: `supabase/migrations/016_venue_profiles.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- VENUE PROFILES
-- A venue's own account — separate from the private `venues`
-- rows that live inside each artist's pipeline. One row per
-- venue account. venue_name is null while signup is still in
-- progress (see the venue signup flow) — the app uses that to
-- tell "mid-signup" apart from "fully signed up."
-- ============================================================

create table public.venue_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,

  venue_name        text,
  address           text,
  city              text,
  venue_type        text,           -- same vocabulary as venues.type (bar, brewery, winery, etc.)
  contact_email     text,
  contact_phone     text,
  description       text,
  genres            text[] default '{}',
  stage_equipment   text,
  photo_url         text,

  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),

  unique(user_id)
);

create trigger venue_profiles_updated_at
  before update on public.venue_profiles
  for each row execute function update_updated_at();

-- Prevents two accounts from ever completing signup as the same venue —
-- the second write to complete a matching (name, city) pair is rejected
-- at the database level. Only applies once BOTH venue_name and city are
-- set (a partial index), since city is optional and two nameless-city
-- venues with the same name are an acceptable, rare gap (the app-level
-- "already claimed" check from search still catches most real cases).
create unique index venue_profiles_name_city_unique
  on public.venue_profiles (lower(venue_name), lower(city))
  where venue_name is not null and city is not null;

alter table public.venue_profiles enable row level security;

-- Owner can read, insert, update, delete their own profile only.
-- No public-read policy — unlike artist_profiles, nothing needs to
-- read a venue's profile before the (future) discovery spec exists.
create policy "own venue profile"
  on public.venue_profiles
  for all
  using (auth.uid() = user_id);

-- ============================================================
-- LINK: venues.venue_profile_id
-- Points an artist's private pipeline row at a real venue
-- account, once one exists and matches. Nullable, never
-- required. Setting/clearing it never touches any other column
-- on the row (notes, stage, confidence, contact info are all
-- untouched) and is done exclusively via a service-role write —
-- an artist's own RLS session can read this column but the
-- "linking sweep" writes to OTHER artists' rows via service role,
-- same as the existing CSV import route does for bulk writes.
-- ============================================================

alter table public.venues
  add column venue_profile_id uuid references public.venue_profiles(id) on delete set null;
```

- [ ] **Step 2: Apply the migration**

Run this file's contents in the Supabase SQL Editor (same process used for every prior migration in this project — there's no CLI migration runner configured).

- [ ] **Step 3: Verify**

In the Supabase SQL Editor, run:

```sql
select column_name, data_type from information_schema.columns where table_name = 'venue_profiles' order by ordinal_position;
select column_name from information_schema.columns where table_name = 'venues' and column_name = 'venue_profile_id';
```

Expected: `venue_profiles` lists all 12 columns above; the second query returns one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/016_venue_profiles.sql
git commit -m "feat: add venue_profiles table and venues.venue_profile_id link"
```

---

### Task 2: Types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add `venue_profile_id` to the existing `Venue` interface**

Find the `Venue` interface and add one field (placed near the end, before `created_at`, to match how other recently-added nullable columns like `gig_time`/`gig_end_time` were appended):

```typescript
export interface Venue {
  id: string;
  zone_id: string;
  user_id: string;
  name: string;
  type: string | null;
  city: string | null;
  website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  stage: VenueStage;
  confidence: ConfidenceLevel;
  live_music_details: string | null;
  zone_ring: string | null;
  notes: string | null;
  last_contacted_at: string | null;
  follow_up_date: string | null;
  address: string | null;
  gig_time: string | null;
  gig_end_time: string | null;
  venue_profile_id: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Add the new `VenueProfile` type**

Add this near the bottom of the file, after the `Invoice` section (following the same `// ====...====` section-header convention used throughout the file):

```typescript
// ============================================================
// VENUE PROFILES
// ============================================================

export interface VenueProfile {
  id: string;
  user_id: string;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  venue_type: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  description: string | null;
  genres: string[];
  stage_equipment: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

// A single candidate result from the venue-signup search — either an
// unclaimed match pulled from some artist's private pipeline, or an
// already-claimed venue_profiles row (surfaced so the search can say
// "taken" instead of offering it as claimable).
export interface VenueMatchCandidate {
  name: string;
  city: string | null;
  address: string | null;
  venue_type: string | null;
  status: "claimable" | "taken";
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: no new errors (existing `Venue` consumers don't destructure `venue_profile_id` yet, so adding an optional-in-practice-but-required-in-type field is safe as long as every place that *constructs* a `Venue` object — mainly `app/api/venues/route.ts`'s insert response, which comes straight from Supabase — already returns it once Task 1's migration is applied; Supabase's generated row will include `venue_profile_id: null` automatically for existing rows).

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "feat: add VenueProfile type and venue_profile_id to Venue"
```

---

### Task 3: Shared venue-matching helper

**Files:**
- Create: `lib/venues/matching.ts`

This is used by three later tasks (the search endpoint, the linking sweep, and the Discover Venues badge/sort) — writing it once here keeps the "same matching logic" promise made throughout the spec actually true in the code, not just in prose.

- [ ] **Step 1: Write the helper**

```typescript
// Shared name+city normalization used everywhere a venue's real-world
// identity needs to be matched against another record — the venue
// signup search, the linking sweep, and Discover Venues' StageReach
// badge. Keeping this in one place is what makes "same matching logic"
// actually true across all three call sites, not just true in the docs.

export function normalizeMatchKey(name: string, city: string | null): string {
  return `${name.trim().toLowerCase()}|${(city ?? "").trim().toLowerCase()}`;
}

interface MatchableVenue {
  name: string;
  city: string | null;
  address: string | null;
  type: string | null;
}

// Collapses duplicate entries that share a normalized name+city down to
// one, preferring whichever has the most of {address, type} filled in.
// Used when several different artists each have their own copy of the
// same real venue in their private pipelines — the venue signing up
// should see one match candidate, not five near-duplicates.
export function dedupeMatchableVenues<T extends MatchableVenue>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = normalizeMatchKey(row.name, row.city);
    const existing = byKey.get(key);
    if (!existing || completeness(row) > completeness(existing)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

function completeness(row: MatchableVenue): number {
  return [row.address, row.type].filter(Boolean).length;
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: no errors (nothing imports this yet).

- [ ] **Step 3: Commit**

```bash
git add lib/venues/matching.ts
git commit -m "feat: add shared venue name+city matching helper"
```

---

### Task 4: Venue profile API — create + fetch own

**Files:**
- Create: `app/api/venue-profile/route.ts`

This task adds `POST` (create the blank placeholder row at account-creation time) and `GET` (fetch the logged-in venue's own profile). `PATCH` — the more complex handler that fills in the profile and triggers the linking sweep — is Task 6, built on top of this file once the matching helper and search endpoint exist.

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Creates the blank venue_profiles row immediately after a venue account
// is authenticated (venue_name left null). This placeholder is what lets
// the app tell "a venue mid-signup" apart from "an artist mid-signup"
// everywhere else — see proxy.ts. Called once, right after
// supabase.auth.signUp() succeeds, from the /venues/signup wizard.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: existing } = await supabase
    .from("venue_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) return NextResponse.json(existing);

  const { data, error } = await supabase
    .from("venue_profiles")
    .insert({ user_id: user.id })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("venue_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });
  return NextResponse.json(data);
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint app/api/venue-profile/route.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/venue-profile/route.ts
git commit -m "feat: add venue profile create/fetch API"
```

---

### Task 5: Search-existing endpoint

**Files:**
- Create: `app/api/venues/search-existing/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeMatchKey, dedupeMatchableVenues } from "@/lib/venues/matching";

// Searches across EVERY artist's private `venues` pipeline rows (not
// just one artist's) to help a signing-up venue find themselves. RLS on
// `venues` scopes reads to auth.uid() = user_id, so a venue account has
// no way to read another artist's rows directly — this requires the
// service-role client, same as the CSV import route uses for bulk
// cross-user writes. Only public-safe fields are ever selected or
// returned: name, city, address, type. Never contact info, notes,
// pipeline stage, confidence, or which artist owns the relationship.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const city = req.nextUrl.searchParams.get("city")?.trim() || null;

  const service = await createServiceClient();

  const { data: pipelineMatches, error: pipelineError } = await service
    .from("venues")
    .select("name, city, address, type")
    .ilike("name", `%${name}%`);

  if (pipelineError) return NextResponse.json({ error: pipelineError.message }, { status: 500 });

  const deduped = dedupeMatchableVenues(pipelineMatches ?? []);

  const { data: claimedProfiles, error: profilesError } = await service
    .from("venue_profiles")
    .select("venue_name, city")
    .not("venue_name", "is", null)
    .ilike("venue_name", `%${name}%`);

  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  const claimedKeys = new Set(
    (claimedProfiles ?? []).map((p) => normalizeMatchKey(p.venue_name as string, p.city))
  );

  const candidates = deduped.map((row) => ({
    name: row.name,
    city: row.city,
    address: row.address,
    venue_type: row.type,
    status: claimedKeys.has(normalizeMatchKey(row.name, row.city)) ? "taken" as const : "claimable" as const,
  }));

  // If the venue's own name+city is already claimed but has no matching
  // pipeline row at all (e.g. someone created a fresh profile with no
  // prior pipeline entry), still surface it as taken so a second person
  // can't attempt to "create fresh" under the same identity.
  if (city && claimedKeys.has(normalizeMatchKey(name, city)) &&
      !candidates.some((c) => normalizeMatchKey(c.name, c.city) === normalizeMatchKey(name, city))) {
    candidates.push({ name, city, address: null, venue_type: null, status: "taken" });
  }

  return NextResponse.json({ candidates });
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint app/api/venues/search-existing/route.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/venues/search-existing/route.ts
git commit -m "feat: add cross-artist venue search endpoint for signup"
```

---

### Task 6: Venue profile PATCH — save details + linking sweep

**Files:**
- Modify: `app/api/venue-profile/route.ts`

- [ ] **Step 1: Add the PATCH handler**

Add this to the same file created in Task 4, alongside the existing `POST`/`GET`:

```typescript
import { normalizeMatchKey } from "@/lib/venues/matching";

// ... (POST and GET unchanged above) ...

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const {
    venue_name, address, city, venue_type,
    contact_email, contact_phone, description,
    genres, stage_equipment, photo_url,
  } = body;

  const { data: current } = await supabase
    .from("venue_profiles")
    .select("venue_name")
    .eq("user_id", user.id)
    .single();

  const isFirstTimeNamed = !current?.venue_name && !!venue_name;

  const { data, error } = await supabase
    .from("venue_profiles")
    .update({
      ...(venue_name !== undefined && { venue_name }),
      ...(address !== undefined && { address }),
      ...(city !== undefined && { city }),
      ...(venue_type !== undefined && { venue_type }),
      ...(contact_email !== undefined && { contact_email }),
      ...(contact_phone !== undefined && { contact_phone }),
      ...(description !== undefined && { description }),
      ...(genres !== undefined && { genres }),
      ...(stage_equipment !== undefined && { stage_equipment }),
      ...(photo_url !== undefined && { photo_url }),
    })
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    // Postgres unique_violation — someone else claimed/created this exact
    // (venue_name, city) pair first. Same message as the search-time
    // "already claimed" case, since from the venue's perspective it's the
    // identical situation, just discovered a moment later than usual.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This venue already has an account — reach out if that's a mistake." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (isFirstTimeNamed) {
    await runLinkingSweep(data.id, data.venue_name as string, data.city);
  }

  return NextResponse.json(data);
}

// Finds every artist's `venues` row matching this venue's name + city
// (the same normalization used by the search endpoint) and sets
// venue_profile_id on all of them — not just whichever row happened to
// surface during search. Writes across other artists' private rows, so
// this goes through the service-role client, same pattern as the
// existing CSV import route uses for cross-user writes; RLS on `venues`
// would otherwise block it entirely. `city` is deliberately `string | null`
// here, not `string` — gating this on city being present was an earlier
// mistake caught in plan review: a venue that signs up without entering a
// city would otherwise never get linked at all, silently breaking the
// badge for exactly that case. `normalizeMatchKey` already treats a null
// city as an empty string on both sides of the comparison, so this just
// works without a special case.
async function runLinkingSweep(venueProfileId: string, venueName: string, city: string | null) {
  const service = await createServiceClient();
  const key = normalizeMatchKey(venueName, city);

  const { data: candidates } = await service
    .from("venues")
    .select("id, name, city")
    .ilike("name", venueName)
    .is("venue_profile_id", null);

  const matchingIds = (candidates ?? [])
    .filter((v) => normalizeMatchKey(v.name, v.city) === key)
    .map((v) => v.id);

  if (matchingIds.length === 0) return;

  await service
    .from("venues")
    .update({ venue_profile_id: venueProfileId })
    .in("id", matchingIds);
}
```

Note the full file now needs `createServiceClient` imported alongside `createClient` at the top (already added in Task 5's sibling file, but this is a different file — make sure the import line reads `import { createClient, createServiceClient } from "@/lib/supabase/server";`).

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint app/api/venue-profile/route.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/venue-profile/route.ts
git commit -m "feat: add venue profile update with cross-pipeline linking sweep"
```

---

### Task 7: Middleware — route venues correctly

**Files:**
- Modify: `proxy.ts`

- [ ] **Step 1: Add `/venues` and `/venues/signup` to public routes, and check `venue_profiles` before the artist onboarding gate**

Find this block:

```typescript
  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === "/login";
  // Public routes that don't require authentication
  const isPublicRoute =
    pathname.startsWith("/profile/") ||
    pathname === "/api/calendar/ics" ||
    pathname === "/api/auth/validate-code" ||
    pathname === "/signup";
```

Replace with:

```typescript
  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === "/login";
  // Public routes that don't require authentication
  const isPublicRoute =
    pathname.startsWith("/profile/") ||
    pathname === "/api/calendar/ics" ||
    pathname === "/api/auth/validate-code" ||
    pathname === "/signup" ||
    pathname === "/venues" ||
    pathname === "/venues/signup";
```

Then find the existing artist-onboarding gate:

```typescript
  // Guard: authenticated users who haven't completed onboarding
  // are redirected to /onboarding. Skip this check on /onboarding
  // itself (would cause infinite redirect) and on all API routes.
  const isOnboardingRoute = pathname === "/onboarding";
  const isApiRoute = pathname.startsWith("/api/");

  if (user && !isPublicRoute && !isLoginPage && !isOnboardingRoute && !isApiRoute) {
    const { data: artistProfile, error: profileError } = await supabase
      .from("artist_profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profileError && !artistProfile?.display_name) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
```

Replace with:

```typescript
  // Guard: authenticated users who haven't completed onboarding
  // are redirected to /onboarding. Skip this check on /onboarding
  // itself (would cause infinite redirect) and on all API routes.
  const isOnboardingRoute = pathname === "/onboarding";
  const isVenueSignupRoute = pathname === "/venues/signup";
  const isApiRoute = pathname.startsWith("/api/");

  if (user && !isPublicRoute && !isLoginPage && !isOnboardingRoute && !isApiRoute) {
    // Venue accounts are unambiguous — a venue_profiles row only ever
    // exists for a venue account, created the moment signup starts (see
    // /api/venue-profile's POST handler). Check this FIRST: without it,
    // the artist_profiles check below would incorrectly bounce every
    // venue account into the artist onboarding wizard, since a venue
    // never has an artist_profiles row at all.
    const { data: venueProfile } = await supabase
      .from("venue_profiles")
      .select("venue_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (venueProfile) {
      if (!venueProfile.venue_name && !isVenueSignupRoute) {
        const url = request.nextUrl.clone();
        url.pathname = "/venues/signup";
        return NextResponse.redirect(url);
      }
      return supabaseResponse;
    }

    const { data: artistProfile, error: profileError } = await supabase
      .from("artist_profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profileError && !artistProfile?.display_name) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint proxy.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "feat: route venue accounts correctly in auth middleware"
```

---

### Task 8: Front door landing page

**Files:**
- Create: `app/venues/page.tsx`

- [ ] **Step 1: Write the page**

Server component, no auth needed (public route). Follows the same dark/gold visual language as the rest of the app.

```tsx
import Link from "next/link";

export default function VenuesLandingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: "#0E0E10" }}>
      <div className="max-w-md w-full text-center">
        <div
          className="text-xs font-semibold uppercase tracking-widest mb-6"
          style={{ color: "#D4A64F" }}
        >
          StageReach for Venues
        </div>
        <h1 className="text-3xl font-bold mb-4" style={{ color: "#F4E8D2" }}>
          Get discovered by artists in your area
        </h1>
        <p className="text-sm mb-8" style={{ color: "#9a9591" }}>
          Set up your venue&apos;s profile — genres you book, your stage setup, how to reach you —
          so artists already using StageReach can find you.
        </p>
        <Link
          href="/venues/signup"
          className="inline-block px-6 py-3 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
          style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
        >
          Set Up My Venue
        </Link>
        <p className="text-xs mt-8" style={{ color: "#5e5c58" }}>
          An artist? <Link href="/login" className="underline">Log in here</Link> instead.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint app/venues/page.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/venues/page.tsx
git commit -m "feat: add venue front door landing page"
```

---

### Task 9: Venue signup wizard

**Files:**
- Create: `app/venues/signup/page.tsx`

This is the biggest single file in this plan — it mirrors `app/onboarding/page.tsx`'s step-based client component pattern. Four steps: create account → search → claim/create → fill in details. Only ONE write to `venue_profiles` beyond the initial blank-row `POST` happens — the final "fill in details" submit sends everything (including `venue_name`) in one `PATCH`, whether it was pre-filled from a claim or typed fresh. This is what the spec means by the linking sweep running "the moment `venue_name` is set" — that moment is this final submit, not the claim-selection click itself.

- [ ] **Step 1: Write the wizard**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VenueMatchCandidate } from "@/types";

type Step = 1 | 2 | 3 | 4;

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "#F4E8D2",
};
const labelStyle = { color: "#9a9591" };

function ProgressBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {[1, 2, 3, 4].map((s) => (
        <div
          key={s}
          className="h-1 flex-1 rounded-full transition-colors duration-300"
          style={{ backgroundColor: s <= step ? "#D4A64F" : "#262b33" }}
        />
      ))}
      <span className="text-xs ml-3 shrink-0" style={{ color: "#9a9591" }}>
        Step {step} of 4
      </span>
    </div>
  );
}

export default function VenueSignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2 (search)
  const [searchName, setSearchName] = useState("");
  const [searchCity, setSearchCity] = useState("");
  const [candidates, setCandidates] = useState<VenueMatchCandidate[]>([]);
  const [searched, setSearched] = useState(false);

  // Step 3/4 (profile form — pre-filled if claiming, blank if fresh)
  const [venueName, setVenueName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [venueType, setVenueType] = useState("");
  const [description, setDescription] = useState("");
  const [genres, setGenres] = useState("");
  const [stageEquipment, setStageEquipment] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/venues/signup` },
    });

    if (signUpError) {
      setError(signUpError.message);
      setSaving(false);
      return;
    }

    const res = await fetch("/api/venue-profile", { method: "POST" });
    if (!res.ok) {
      setError("Something went wrong setting up your account — please try again.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setStep(2);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!searchName.trim()) return;

    setSaving(true);
    const params = new URLSearchParams({ name: searchName.trim() });
    if (searchCity.trim()) params.append("city", searchCity.trim());

    const res = await fetch(`/api/venues/search-existing?${params}`);
    if (res.ok) {
      const data = await res.json();
      setCandidates(data.candidates ?? []);
    }
    setSearched(true);
    setSaving(false);
  }

  function claimCandidate(candidate: VenueMatchCandidate) {
    setVenueName(candidate.name);
    setCity(candidate.city ?? "");
    setAddress(candidate.address ?? "");
    setVenueType(candidate.venue_type ?? "");
    setStep(4);
  }

  function startFresh() {
    setVenueName(searchName);
    setCity(searchCity);
    setStep(4);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!venueName.trim()) {
      setError("Venue name is required.");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/venue-profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_name: venueName.trim(),
        city: city.trim() || null,
        address: address.trim() || null,
        venue_type: venueType.trim() || null,
        description: description.trim() || null,
        genres: genres.split(",").map((g) => g.trim()).filter(Boolean),
        stage_equipment: stageEquipment.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't save your profile — please try again.");
      setSaving(false);
      return;
    }

    router.push("/venue/profile");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ backgroundColor: "#0E0E10" }}>
      <div className="max-w-md w-full">
        <ProgressBar step={step} />

        {error && (
          <p className="text-sm mb-4 px-3 py-2 rounded-lg" style={{ backgroundColor: "rgba(226,92,92,0.1)", color: "#e25c5c" }}>
            {error}
          </p>
        )}

        {step === 1 && (
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <h1 className="text-xl font-bold mb-1" style={{ color: "#F4E8D2" }}>Set up your venue</h1>
            <p className="text-sm mb-4" style={labelStyle}>No invite code needed — just create a login.</p>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Password</label>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <button type="submit" disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Creating account…" : "Continue"}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleSearch} className="space-y-4">
            <h1 className="text-xl font-bold mb-1" style={{ color: "#F4E8D2" }}>Is your venue already here?</h1>
            <p className="text-sm mb-4" style={labelStyle}>
              Artists may have already added your venue. Search to check before creating a new listing.
            </p>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Venue name</label>
              <input required value={searchName} onChange={(e) => setSearchName(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>City (optional)</label>
              <input value={searchCity} onChange={(e) => setSearchCity(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <button type="submit" disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Searching…" : "Search"}
            </button>

            {searched && (
              <div className="pt-2 space-y-2">
                {candidates.filter((c) => c.status === "claimable").length === 0 && (
                  <p className="text-xs" style={labelStyle}>No matches found.</p>
                )}
                {candidates.map((c, i) => (
                  <div key={i} className="rounded-lg px-3 py-2.5 flex items-center justify-between gap-2"
                    style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="min-w-0">
                      <p className="text-sm truncate" style={{ color: "#F4E8D2" }}>{c.name}</p>
                      <p className="text-xs truncate" style={labelStyle}>{[c.venue_type, c.city].filter(Boolean).join(" · ")}</p>
                    </div>
                    {c.status === "claimable" ? (
                      <button type="button" onClick={() => claimCandidate(c)}
                        className="text-xs px-2.5 py-1 rounded font-semibold shrink-0 transition-all hover:brightness-110"
                        style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}>
                        This is me
                      </button>
                    ) : (
                      <span className="text-xs shrink-0" style={{ color: "#5e5c58" }}>Already claimed</span>
                    )}
                  </div>
                ))}
                <button type="button" onClick={startFresh}
                  className="w-full py-2 rounded-lg text-xs font-medium transition-all hover:brightness-110 mt-2"
                  style={{ backgroundColor: "rgba(255,255,255,0.04)", color: "#9a9591" }}>
                  None of these are me — create a new listing
                </button>
              </div>
            )}
          </form>
        )}

        {step === 4 && (
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <h1 className="text-xl font-bold mb-1" style={{ color: "#F4E8D2" }}>Tell artists about your venue</h1>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Venue name</label>
              <input required value={venueName} onChange={(e) => setVenueName(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1.5" style={labelStyle}>City</label>
                <input value={city} onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={labelStyle}>Venue type</label>
                <input value={venueType} onChange={(e) => setVenueType(e.target.value)} placeholder="Bar, brewery, winery…"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Address</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Description</label>
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Genres you book (comma-separated)</label>
              <input value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="rock, jazz, acoustic"
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Stage & equipment</label>
              <textarea rows={2} value={stageEquipment} onChange={(e) => setStageEquipment(e.target.value)} placeholder="PA system, stage size, backline…"
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1.5" style={labelStyle}>Contact email</label>
                <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={labelStyle}>Contact phone</label>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
            </div>
            <button type="submit" disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving…" : "Finish Setup"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

Note: `step === 3` is intentionally unused as a distinct screen — claiming or starting fresh both jump straight to `step 4` (the profile form), pre-filled or blank respectively. The progress bar still shows 4 steps to give the venue an accurate sense of "almost done," matching the spec's step numbering (search is step 2, claim-or-create is the decision made at the end of step 2's results, fill-in-details is step 4).

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint app/venues/signup/page.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/venues/signup/page.tsx
git commit -m "feat: add venue signup wizard"
```

---

### Task 10: Venue protected profile page

**Files:**
- Create: `app/venue/profile/page.tsx`

Deliberately outside the `(protected)` route group — that group's layout renders the artist `Sidebar` with artist-only nav links (Pipeline, Discover, Invoices), which don't apply to a venue account. This page is protected purely by `proxy.ts`'s middleware (any path not in the public-route list requires auth), with its own minimal layout.

- [ ] **Step 1: Write the page**

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VenueProfile } from "@/types";

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "#F4E8D2",
};
const labelStyle = { color: "#9a9591" };

export default function VenueProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<VenueProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/venue-profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => setProfile(p))
      .finally(() => setLoading(false));
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/venues");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setSaved(false);

    const res = await fetch("/api/venue-profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_name: profile.venue_name,
        city: profile.city,
        address: profile.address,
        venue_type: profile.venue_type,
        description: profile.description,
        genres: profile.genres,
        stage_equipment: profile.stage_equipment,
        contact_email: profile.contact_email,
        contact_phone: profile.contact_phone,
      }),
    });

    if (res.ok) {
      setProfile(await res.json());
      setSaved(true);
    }
    setSaving(false);
  }

  if (loading) return null;
  if (!profile) return <div className="p-8" style={{ color: "#9a9591" }}>Couldn&apos;t load your profile.</div>;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "#F4E8D2" }}>{profile.venue_name}</h1>
          <button onClick={handleSignOut} className="text-xs" style={labelStyle}>Sign out</button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Venue name</label>
            <input required value={profile.venue_name ?? ""} onChange={(e) => setProfile({ ...profile, venue_name: e.target.value })}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>City</label>
              <input value={profile.city ?? ""} onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Venue type</label>
              <input value={profile.venue_type ?? ""} onChange={(e) => setProfile({ ...profile, venue_type: e.target.value })}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Address</label>
            <input value={profile.address ?? ""} onChange={(e) => setProfile({ ...profile, address: e.target.value })}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Description</label>
            <textarea rows={3} value={profile.description ?? ""} onChange={(e) => setProfile({ ...profile, description: e.target.value })}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Genres you book</label>
            <input value={profile.genres.join(", ")} onChange={(e) => setProfile({ ...profile, genres: e.target.value.split(",").map((g) => g.trim()).filter(Boolean) })}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Stage & equipment</label>
            <textarea rows={2} value={profile.stage_equipment ?? ""} onChange={(e) => setProfile({ ...profile, stage_equipment: e.target.value })}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Contact email</label>
              <input type="email" value={profile.contact_email ?? ""} onChange={(e) => setProfile({ ...profile, contact_email: e.target.value })}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Contact phone</label>
              <input value={profile.contact_phone ?? ""} onChange={(e) => setProfile({ ...profile, contact_phone: e.target.value })}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
          </div>
          <button type="submit" disabled={saving}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {saved && <span className="text-xs ml-3" style={{ color: "#4caf7d" }}>Saved</span>}
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint app/venue/profile/page.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/venue/profile/page.tsx
git commit -m "feat: add venue's own protected profile page"
```

---

### Task 11: Pipeline card badge

**Files:**
- Modify: `components/venue/VenueCard.tsx`

- [ ] **Step 1: Add the badge next to the confidence badge**

Find:

```tsx
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span
              className="text-xs px-1.5 py-0.5 rounded border font-medium"
              style={{
                backgroundColor: conf.bg,
                color: conf.color,
                borderColor: conf.border,
              }}
            >
              {conf.label}
            </span>
```

Replace with:

```tsx
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span
              className="text-xs px-1.5 py-0.5 rounded border font-medium"
              style={{
                backgroundColor: conf.bg,
                color: conf.color,
                borderColor: conf.border,
              }}
            >
              {conf.label}
            </span>

            {venue.venue_profile_id && (
              <span
                className="text-xs px-1.5 py-0.5 rounded border font-medium"
                style={{ backgroundColor: "rgba(212,166,79,0.1)", color: "#D4A64F", borderColor: "rgba(212,166,79,0.3)" }}
                title="This venue has a real StageReach account"
              >
                ⭐ On StageReach
              </span>
            )}
```

This is read-only — no click handler, no way for the artist to set or clear it, matching the spec exactly.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint components/venue/VenueCard.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/venue/VenueCard.tsx
git commit -m "feat: show On StageReach badge on linked pipeline cards"
```

---

### Task 12: Venue detail page badge

**Files:**
- Modify: `components/venue/VenueDetail.tsx`

- [ ] **Step 1: Add the badge to the header, next to the stage badge**

Find:

```tsx
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("text-xs px-2 py-1 rounded-full font-medium", STAGE_COLORS[venue.stage])}>
            {STAGES.find((s) => s.key === venue.stage)?.label}
          </span>
```

Replace with:

```tsx
        <div className="flex items-center gap-2 shrink-0">
          {venue.venue_profile_id && (
            <span
              className="text-xs px-2 py-1 rounded-full font-medium"
              style={{ backgroundColor: "rgba(212,166,79,0.1)", color: "#D4A64F" }}
              title="This venue has a real StageReach account"
            >
              ⭐ On StageReach
            </span>
          )}
          <span className={cn("text-xs px-2 py-1 rounded-full font-medium", STAGE_COLORS[venue.stage])}>
            {STAGES.find((s) => s.key === venue.stage)?.label}
          </span>
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint components/venue/VenueDetail.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/venue/VenueDetail.tsx
git commit -m "feat: show On StageReach badge on venue detail page"
```

---

### Task 13: Accept `venue_profile_id` when adding a venue to pipeline

**Files:**
- Modify: `app/api/venues/route.ts`

- [ ] **Step 1: Accept and store the optional field**

Find:

```typescript
  const body = await request.json();
  const { name, type, city, website, contact_name, contact_email, contact_phone, stage, confidence, notes } = body;
```

Replace with:

```typescript
  const body = await request.json();
  const { name, type, city, website, contact_name, contact_email, contact_phone, stage, confidence, notes, venue_profile_id } = body;
```

Find:

```typescript
      stage: stage ?? "discovered",
      confidence: confidence ?? "MEDIUM",
      notes: notes ?? null,
    })
```

Replace with:

```typescript
      stage: stage ?? "discovered",
      confidence: confidence ?? "MEDIUM",
      notes: notes ?? null,
      venue_profile_id: venue_profile_id ?? null,
    })
```

This is safe to accept from any authenticated request — it's just a foreign key an artist is choosing to set on their own new pipeline row (RLS already scopes the insert to `user_id: user.id`), not a cross-user write. It's populated by Task 15 below when adding a Discover Venues result that was already badged as a StageReach match — never something an artist manually types in.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint app/api/venues/route.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/venues/route.ts
git commit -m "feat: accept venue_profile_id when adding a venue to pipeline"
```

---

### Task 14: Discover Venues — badge and always-first sort

**Files:**
- Modify: `app/api/venues/discover/route.ts`

- [ ] **Step 1: Extend `DiscoverResult` and add the matching+sort step**

Find:

```typescript
type DiscoverResult = {
  osm_id: string;
  name: string;
  type: string;
  city: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  rating: number | null;
  review_count: number;
  live_music_tagged: boolean;
  already_in_pipeline: boolean;
};
```

Replace with:

```typescript
type DiscoverResult = {
  osm_id: string;
  name: string;
  type: string;
  city: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  rating: number | null;
  review_count: number;
  live_music_tagged: boolean;
  already_in_pipeline: boolean;
  venue_profile_id: string | null;
};
```

Add the import at the top:

```typescript
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeMatchKey } from "@/lib/venues/matching";
```

(This changes the existing `import { createClient } from "@/lib/supabase/server";` line to also import `createServiceClient`.)

Add this new function anywhere below the type definitions (e.g. right after `type DiscoverResult = {...}`):

```typescript
// Cross-checks a batch of Discover Venues results against real venue
// accounts, tags each with venue_profile_id when matched, and moves
// every match to the front. Discover Venues has no existing sort of its
// own today — results just render in whatever order Google/Geoapify/OSM
// returned them — so this is the first ranking rule the feature gets,
// not a change to one that already existed.
async function attachStageReachMatches(results: DiscoverResult[]): Promise<DiscoverResult[]> {
  if (results.length === 0) return results;

  const service = await createServiceClient();
  const { data: profiles } = await service
    .from("venue_profiles")
    .select("id, venue_name, city")
    .not("venue_name", "is", null);

  if (!profiles || profiles.length === 0) return results;

  const profileByKey = new Map(
    profiles.map((p) => [normalizeMatchKey(p.venue_name as string, p.city), p.id as string])
  );

  const tagged = results.map((r) => ({
    ...r,
    venue_profile_id: profileByKey.get(normalizeMatchKey(r.name, r.city)) ?? null,
  }));

  return [...tagged].sort((a, b) => {
    if (!!a.venue_profile_id === !!b.venue_profile_id) return 0;
    return a.venue_profile_id ? -1 : 1;
  });
}
```

Find the two `NextResponse.json` return points:

```typescript
  if (merged.length > 0) {
    return NextResponse.json({ results: merged });
  }

  // ── 3. Overpass fallback — only if both of the above came up empty ─────────
  try {
    const results = await searchWithOverpass(lat, lon, radiusMeters, existingNames);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Search unavailable — please try again." }, { status: 502 });
  }
```

Replace with:

```typescript
  if (merged.length > 0) {
    return NextResponse.json({ results: await attachStageReachMatches(merged) });
  }

  // ── 3. Overpass fallback — only if both of the above came up empty ─────────
  try {
    const results = await searchWithOverpass(lat, lon, radiusMeters, existingNames);
    return NextResponse.json({ results: await attachStageReachMatches(results) });
  } catch {
    return NextResponse.json({ error: "Search unavailable — please try again." }, { status: 502 });
  }
```

Every place `DiscoverResult` objects are constructed inside `searchWithGoogle`/`searchWithGeoapify`/`searchWithOverpass` needs the new field added at construction time too — find each of the three `already_in_pipeline: existingNames.has(...)` lines and add `venue_profile_id: null,` immediately after each one (it gets filled in by `attachStageReachMatches` afterward; `null` here is just to satisfy the type before that step runs). Note: the `searchWithGoogle` and `searchWithGeoapify` lines are textually identical (`already_in_pipeline: existingNames.has(name.toLowerCase().trim()),`), so a plain find/replace will hit whichever comes first twice — edit them by function (search for `async function searchWithGoogle` and `async function searchWithGeoapify` first, then find the line within each), not by blind text search.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint app/api/venues/discover/route.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/venues/discover/route.ts
git commit -m "feat: badge and rank real venue accounts first in Discover Venues"
```

---

### Task 15: Discover Venues UI — render badge, pass link on add

**Files:**
- Modify: `components/discover/DiscoverView.tsx`

- [ ] **Step 1: Add the field to the client-side type**

Find:

```typescript
type DiscoverResult = {
  osm_id: string;
  name: string;
  type: string;
  city: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  rating: number | null;
  review_count: number;
  live_music_tagged: boolean;
  already_in_pipeline: boolean;
};
```

Replace with:

```typescript
type DiscoverResult = {
  osm_id: string;
  name: string;
  type: string;
  city: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  rating: number | null;
  review_count: number;
  live_music_tagged: boolean;
  already_in_pipeline: boolean;
  venue_profile_id: string | null;
};
```

- [ ] **Step 2: Render the badge**

Find:

```tsx
                          {venue.live_music_tagged && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full self-start"
                              style={{ backgroundColor: "rgba(76,175,125,0.15)", color: "#4caf7d", border: "1px solid #4caf7d44" }}
                            >
                              🎵 Live music confirmed
                            </span>
                          )}
```

Replace with:

```tsx
                          {venue.venue_profile_id && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full self-start"
                              style={{ backgroundColor: "rgba(212,166,79,0.15)", color: "#D4A64F", border: "1px solid #D4A64F44" }}
                            >
                              ⭐ On StageReach
                            </span>
                          )}

                          {venue.live_music_tagged && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full self-start"
                              style={{ backgroundColor: "rgba(76,175,125,0.15)", color: "#4caf7d", border: "1px solid #4caf7d44" }}
                            >
                              🎵 Live music confirmed
                            </span>
                          )}
```

- [ ] **Step 3: Pass the link through when adding to pipeline**

Find, inside `handleAdd`:

```typescript
    const res = await fetch("/api/venues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: venue.name,
        type: venue.type,
        city: venue.city,
        address: venue.address,
        website: venue.website,
        contact_phone: venue.phone,
        stage: "discovered",
      }),
    });
```

Replace with:

```typescript
    const res = await fetch("/api/venues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: venue.name,
        type: venue.type,
        city: venue.city,
        address: venue.address,
        website: venue.website,
        contact_phone: venue.phone,
        stage: "discovered",
        venue_profile_id: venue.venue_profile_id,
      }),
    });
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npx eslint components/discover/DiscoverView.tsx
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/discover/DiscoverView.tsx
git commit -m "feat: show StageReach badge in Discover Venues and link on add"
```

---

### Task 16: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `CLAUDE.md`'s Core Data Model section**

Add a `venue_profiles` entry alongside the existing `email_connections` bullet:

```
- venue_profiles — a venue's own account (separate from the private `venues` rows inside an artist's pipeline). venue_name is null until signup finishes. A unique index on (venue_name, city) prevents duplicate claims. Linked from the artist side via the new nullable `venues.venue_profile_id` column.
```

- [ ] **Step 2: Add a new Key Flows entry**

Add after the "Diagnostics" entry, following the same format as other flow descriptions:

```
Venue Accounts — venues get their own accounts, entirely separate from artist accounts. `/venues` is a public landing page; `/venues/signup` is a 4-step wizard (create account → search existing pipeline entries → claim or start fresh → fill in profile details). Signup is open, no invite code. Searching (`GET /api/venues/search-existing`) and the "linking sweep" that runs once a venue's name is saved (`PATCH /api/venue-profile`) both use the service-role client to read/write across every artist's private `venues` rows — the same pattern the CSV import route uses — since RLS otherwise scopes `venues` to its owning artist. The linking sweep sets `venue_profile_id` on every matching pipeline row across every artist, not just the one interacted with during claim, which is what powers the "⭐ On StageReach" badge shown on pipeline cards (`components/venue/VenueCard.tsx`), the venue detail page, and Discover Venues search results — where a real StageReach account is also always ranked first. `proxy.ts` checks for a `venue_profiles` row before the artist-onboarding check, so venue accounts never get misrouted into the artist onboarding wizard. Logged-in venues manage their profile at `/venue/profile` — the entire venue-facing app surface for now; artist discovery and booking are future work.
```

- [ ] **Step 3: Add a CHANGELOG entry**

```markdown
## 2026-08-13 (2)
- [Feature] Venues can now create their own StageReach account at stagereach.app/venues — search to claim a listing an artist already has in their pipeline, or create a fresh one if nobody's found them yet. No invite code needed.
- [Feature] Any venue with a real account now shows a "⭐ On StageReach" badge on your pipeline cards and venue detail page, and always appears first in Discover Venues search results.
```

(Add above the existing `## 2026-08-13` entry, keeping newest-first.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document venue accounts feature"
```

---

## Manual Verification (after all tasks complete)

No automated test suite exists — verify live in the browser:

1. Visit `/venues`, click through to `/venues/signup`, create a test venue account with an email you can access.
2. Search for a venue name that already exists in your (the artist's) pipeline. Confirm it shows as claimable, claim it, confirm the profile form is pre-filled.
3. Log in as the artist and check that pipeline card now shows the "⭐ On StageReach" badge, and the venue detail page shows it too.
4. Run a Discover Venues search in an area where that same venue would show up (or another claimed one) and confirm the badge appears there too, sorted first.
5. Add a fresh, unclaimed Discover Venues result to the pipeline, then have a new venue account search for and claim that exact venue — confirm the badge appears on that pipeline card after claiming.
6. Try claiming/creating the same venue name+city from a second venue account — confirm it's rejected with the "already has an account" message, not a duplicate.
7. Log out and log back in as the venue account — confirm it lands on `/venue/profile`, not the artist onboarding wizard or dashboard.
8. Edit and save the venue profile from `/venue/profile`, confirm it persists on reload.
