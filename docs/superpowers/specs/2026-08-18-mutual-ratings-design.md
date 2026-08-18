# Mutual Ratings — Design

## Overview

This is the third and final piece of StageReach's venue-facing portal — and the original feature request that started the whole effort: venues and artists rate each other, 1-5 stars, after actually working together. The first two pieces (venue accounts & login, artist discovery for venues) are shipped and live. This piece closes the loop: once a venue and an artist have a real, verified interaction (a completed gig, with the venue linked to a real StageReach account), each can rate the other. Ratings are double-blind — neither side sees the other's rating until both have submitted — and stay visible publicly afterward so both sides can use track record to decide who to work with.

Booking/scheduling remains out of scope, unchanged from the prior spec — still a future idea, not built here.

---

## Goals

- An artist who has logged a gig, marked it "completed," at a venue linked to a real StageReach account can rate that venue (1-5 stars, optional written review) — and the venue can rate that artist back, under the same condition
- Neither side sees the other's rating until both have submitted (double-blind)
- Each venue-artist relationship gets exactly one rating from each side, ever — not one per gig, even if they work together repeatedly
- Ratings can be edited any time by the person who gave them, including after both sides have revealed to each other
- Both sides get a dedicated page listing who they're eligible to rate, and a history of ratings they've already given
- Revealed ratings show publicly — on the artist's existing public profile, and on a new public venue profile page that doesn't exist yet — so anyone deciding who to pitch or book can see real track record
- Revealed ratings also show as a small badge on the existing Discover Venues / Discover Artists result cards
- Anyone can report a review they believe is abusive or false; reports email Taylor directly
- Two email notifications keep the feature from going unused: one when a new rating becomes available to give, one when the other side's rating is revealed

## Non-Goals

- **No reply/response mechanism.** A venue can't publicly respond to an artist's review of them, or vice versa.
- **No minimum rating count before showing an average.** Even a single 5-star rating displays as "5.0 (1)" — the user base is small enough that this isn't misleading, and gating it would mean many profiles show nothing at all.
- **No admin moderation dashboard.** Reports send an email; removing a review (if ever needed) is a direct Supabase action, the same way the recent test-account cleanup was done.
- **No changes to the existing "⭐ On StageReach" account badge.** That badge means "has a real account" — an unrelated concept from ratings, and it isn't touched by this work.
- **No revoking a rating if the underlying gig's status later changes away from "completed."** Once a rating has actually been given, it stands — this only affects whether a *new* rating opportunity would appear for a gig that hasn't been rated yet.
- **No behavior changes to booking, gigs, or any existing pipeline feature** beyond the one new email trigger described below when a gig is marked completed.

---

## What Changes

### Data model

**New table: `venue_artist_ratings`** — one row per venue-artist relationship, with two independent halves:

```sql
create table venue_artist_ratings (
  id uuid primary key default gen_random_uuid(),
  venue_profile_id uuid not null references venue_profiles(id),
  artist_user_id uuid not null references profiles(id),
  qualifying_gig_id uuid references gigs(id) on delete set null,

  venue_stars smallint check (venue_stars between 1 and 5),
  venue_review text,
  venue_rated_at timestamptz,

  artist_stars smallint check (artist_stars between 1 and 5),
  artist_review text,
  artist_rated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_profile_id, artist_user_id)
);
```

**First-submission validation is required, not optional.** When `POST /api/ratings` or `POST /api/venue/ratings` receives a first submission for a relationship (the row doesn't exist yet), the server must verify the supplied `qualifying_gig_id` actually proves eligibility for *this specific* relationship — not just that the caller owns some completed gig somewhere. Concretely: the gig's `status` must be `"completed"`, the gig's `user_id` must equal the calling artist (for artist submissions) or the gig's `venue_id` must resolve to a `venues` row whose `venue_profile_id` equals the calling venue's own id (for venue submissions). Without this check, a caller could attach an unrelated completed gig they own to rate a venue/artist they never actually worked with.

- **Revealed** means both `venue_rated_at` and `artist_rated_at` are non-null. This is computed at read time, not stored as a separate flag — there's nothing to keep in sync.
- **Eligibility is computed live, not pre-materialized.** No background job creates rows in advance. When an artist or venue asks "who can I rate," the API finds every completed gig at a linked venue, groups by the relationship, and excludes any relationship where that caller's half is already filled in. This is simpler than pre-creating rows and avoids any "did the row get created yet" sync bug.
- **First submission requires proof of eligibility** (`qualifying_gig_id` — a completed gig the caller is actually party to); later edits to an existing row don't need this since the row already exists.
- `qualifying_gig_id` is nullable with `on delete set null` — if the underlying gig is ever deleted later, the rating itself is untouched; the reference is just informational ("rated after your gig on [date]").

**New table: `venue_artist_rating_reports`** — a lightweight report log:

```sql
create table venue_artist_rating_reports (
  id uuid primary key default gen_random_uuid(),
  rating_id uuid not null references venue_artist_ratings(id) on delete cascade,
  reporter_user_id uuid not null references profiles(id),
  reason text,
  created_at timestamptz not null default now()
);
```

**Access pattern — why no RLS-based double-blind:** Postgres RLS controls which *rows* a query can see, not which *columns* — there's no way to express "hide the venue's half of this specific row until the artist's half is also filled in" using row-level policies alone. So `venue_artist_ratings` and its reports table get RLS enabled with no client-facing policies (same pattern as `invite_codes` — "no RLS, queried only via service role"). Every read and write goes through a server API route using the service-role client, which decides in code what to return and what to allow — the same approach already used for cross-user reads elsewhere (the venue-signup search, the linking sweep).

### New API routes (artist side)

- `GET /api/ratings/pending` — relationships where the calling artist has a completed gig at a linked venue and hasn't rated yet
- `GET /api/ratings` — every relationship the artist has rated, showing their own half always and the venue's half once revealed
- `POST /api/ratings` — submit or edit the artist's half (`venue_profile_id`, `stars`, `review`, and `qualifying_gig_id` on first submission)

### New API routes (venue side)

- `GET /api/venue/ratings/pending` — mirror of the above, for the logged-in venue
- `GET /api/venue/ratings` — mirror of the above
- `POST /api/venue/ratings` — submit or edit the venue's half

### Shared / public routes

- `POST /api/ratings/[id]/report` — only the two parties on that specific rating can report it (verified server-side against `venue_profile_id`/`artist_user_id`). The rating must also already be **revealed** (both `*_rated_at` set) — the UI only ever shows a Report link once revealed, and the server enforces the same rule, so a rating can't be reported before the reporter has actually seen it. A valid report inserts a row and emails Taylor the review content plus a direct link to the row.
- `GET /api/public/venues/[id]/ratings` — public, no login required; returns only revealed ratings for a venue plus the aggregate (average, count) — powers the new `/venues/[id]` page
- `GET /api/public/artists/[id]/ratings` — public, no login required; same shape for an artist — powers a new section on the existing `/profile/[id]` page

Both public read routes live under a dedicated `/api/public/` prefix rather than nesting under `/api/venues/` or `/api/artists/` — this keeps `proxy.ts`'s public-route allowlist a single simple prefix check (`pathname.startsWith("/api/public/")`) instead of a route-specific regex, and avoids any risk of accidentally exposing other, non-public routes that happen to share the `/api/venues/...` or `/api/artists/...` path shape (e.g. `/api/venues/discover-artists` must stay behind login).

### New public page: `/venues/[id]`

Venues don't have any public page today — `/venue/profile` is private management only. This new route (plural `/venues`, matching the existing public `/venues` landing page — distinct from the private singular `/venue/profile`) shows a venue's public info (name, city, type, genres, description, photo — everything already in `venue_profiles`) plus a new ratings section: average stars, review count, and the list of individual revealed reviews, each linking to the reviewing artist's own `/profile/[id]`.

### Middleware update (required — not optional)

`proxy.ts`'s `isPublicRoute` check currently only exact-matches `pathname === "/venues"` and `pathname === "/venues/signup"` — there's no prefix match for anything under `/venues/`, and neither of the new `/api/public/...` routes is listed at all. As written, an unauthenticated visitor would be redirected to `/login` before ever reaching the new public venue page or either public ratings endpoint. Two additions are needed: a prefix match on `pathname.startsWith("/venues/")` (safe — `/venues/signup` already matches this prefix, so the existing explicit check for it becomes redundant but harmless), and a prefix match on `pathname.startsWith("/api/public/")` for the two new public API routes.

### Existing page changed: `/profile/[id]`

Gets the same ratings section added — average stars, count, and the list of revealed venue reviews.

### New pages: pending-ratings lists

- `/ratings` (artist side, added to the existing Sidebar) — two sections: "Awaiting your rating" (inline star-picker + optional text + submit, no separate page per rating) and "Ratings you've given" (your submitted half, the counterpart's half once revealed, an Edit link, and a Report link once revealed).
- `/venue/ratings` (venue side, added to `VenueNav`) — same structure.
- Both nav entries get a small badge showing the pending count.

### Discover Venues / Discover Artists — rating badges

Both existing search endpoints (`GET /api/venues/discover` and `GET /api/venues/discover-artists`) are extended to include an aggregate `avg_rating` / `rating_count` per result, computed from revealed rows only. Result cards on both `DiscoverView.tsx` (artist side) and `/venue/discover` (venue side) show a small star badge when a result has at least one revealed rating — nothing shown otherwise, rather than a misleading "0 stars."

### Email notifications

Both reuse the existing shared Resend sender (`booking@stagereach.app`, the verified domain from the 2026-07-15 deliverability fix) — these are platform notifications about the user's own account, not pitch emails sent on an artist's behalf, so they don't go through the personal Gmail/Outlook sending path.

1. **"You have a new gig to rate"** — triggered inside the existing `PATCH /api/gigs/[id]` handler, the moment a gig's `status` changes to `"completed"` (from something else) on a gig whose venue is linked (`venue_profile_id` set). Before sending to either side, the handler checks whether that side has already rated this relationship (their half of the `venue_artist_ratings` row, if one exists, is already filled in) — if so, this gig isn't a new opportunity for them (one rating per relationship, ever), and they're skipped. This matters in particular for a venue and artist who work together repeatedly: without this check, every subsequent completed gig would re-send "new gig to rate" even after that relationship was already fully rated. Recipient emails are read from `profiles.email` — the same lookup already used by the existing automated follow-up cron (`app/api/venues/follow-up/route.ts`), populated for every account (artist or venue) by the `handle_new_user` trigger on signup.
2. **"Your rating was revealed"** — triggered inside `POST /api/ratings` and `POST /api/venue/ratings`, the moment a submission causes the *second* half to become filled in (checked by comparing the row's state before and after the update). Sent only to whichever side had already submitted and was waiting. Recipient email uses the same `profiles.email` lookup as above.

---

## Data Flow

1. An artist marks a gig "completed" on a venue that's linked to a real account → both sides get a "new gig to rate" email.
2. Either side visits their pending-ratings page, sees the relationship listed, and submits stars (+ optional review).
3. Nothing is revealed yet — the submitter's own history page shows their half with "awaiting their response."
4. The other side submits their half (any time later — no time limit). The moment both halves exist, both sides get a "revealed" email, and from then on each can see the other's rating in their history page.
5. The revealed rating now also appears publicly — on the artist's `/profile/[id]` and the venue's new `/venues/[id]` page, and as a small badge on Discover Venues / Discover Artists result cards.
6. Either side can edit their own half at any time, including after reveal — the public/aggregate view always reflects the latest submitted value.
7. Either side can report a revealed review; you get an email and can remove it directly via Supabase if warranted.

---

## Files Touched (indicative — exact structure to be finalized in the implementation plan)

| Area | Change |
|---|---|
| `supabase/migrations/018_venue_artist_ratings.sql` | New — `venue_artist_ratings` and `venue_artist_rating_reports` tables, RLS enabled with no client policies |
| `types/index.ts` | New `VenueArtistRating`, `VenueArtistRatingReport` types |
| `app/api/ratings/route.ts` | New — artist's `GET`/`POST` |
| `app/api/ratings/pending/route.ts` | New — artist's pending list |
| `app/api/ratings/[id]/report/route.ts` | New — report endpoint, shared by both sides |
| `app/api/venue/ratings/route.ts` | New — venue's `GET`/`POST` |
| `app/api/venue/ratings/pending/route.ts` | New — venue's pending list |
| `app/api/public/venues/[id]/ratings/route.ts` | New — public, revealed ratings + aggregate for a venue |
| `app/api/public/artists/[id]/ratings/route.ts` | New — public, revealed ratings + aggregate for an artist |
| `app/api/gigs/[id]/route.ts` | Modified — fires the "new gig to rate" email when status transitions to `completed` on a linked venue, skipping any side that's already rated this relationship |
| `proxy.ts` | Modified — adds `/venues/` and `/api/public/` as public-route prefixes so the new public page and endpoints are reachable without login |
| `app/venues/[id]/page.tsx` | New — public venue profile page |
| `app/profile/[id]/page.tsx` | Modified — adds the ratings section |
| `app/ratings/page.tsx` | New — artist pending-ratings page |
| `app/venue/ratings/page.tsx` | New — venue pending-ratings page |
| `components/Sidebar.tsx` (or equivalent) | Modified — adds "Ratings" nav link + pending-count badge |
| `components/venue/VenueNav.tsx` | Modified — adds "Ratings" nav link + pending-count badge |
| `components/discover/DiscoverView.tsx` | Modified — shows rating badge on result cards |
| `app/venue/discover/page.tsx` | Modified — shows rating badge on result cards |
| `app/api/venues/discover/route.ts` | Modified — includes aggregate rating per result |
| `app/api/venues/discover-artists/route.ts` | Modified — includes aggregate rating per result |
| `lib/email/*` | New helper for the two notification emails (shared Resend sender) |
