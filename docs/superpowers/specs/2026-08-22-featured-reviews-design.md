# Featured Reviews — Design Spec

**Status:** Approved by Taylor (2026-08-22)

## Background

StageReach's mutual ratings feature (shipped 2026-08-18) lets artists and venues rate each other after a completed, linked gig. Once both sides have rated, the relationship "reveals" and both reviews become visible — currently as a single flat list on the public profile (`app/profile/[id]/page.tsx` for artists, `app/venues/profile/[id]/page.tsx` for venues), rendered by the shared `components/ratings/RatingsSection.tsx` client component. There is no ordering, no limit, and no way for the reviewed party to choose which reviews stand out. This was part of Taylor's original request for mutual ratings but was not built in the first pass.

This spec covers letting the reviewed party (the artist, for reviews they received from venues; the venue, for reviews they received from artists) pick up to 3 favorite reviews to feature at the top of their public profile's ratings section, with everything else available behind a "Load more reviews" button.

## Non-Goals

- No change to the rating/reveal mechanism itself, the double-blind logic, or the report flow.
- No reordering of "Ratings you've given" — this only affects reviews *received*.
- No pagination beyond one "load more" reveal (the public ratings endpoints already return the full list in one response with no limit; that doesn't change).
- No admin/moderation surface for featured picks.

## Data Model

Add two nullable columns to the existing `venue_artist_ratings` table (migration `supabase/migrations/020_featured_reviews.sql`):

- `featured_by_artist_rank smallint` — set by the artist when they feature the venue's review of them (the row's `venue_review`/`venue_stars`). Values 1, 2, or 3. Null = not featured.
- `featured_by_venue_rank smallint` — set by the venue when they feature the artist's review of them (`artist_review`/`artist_stars`). Same value range.

Each column gets a partial unique index enforcing at most one row per rank per owning party:
```sql
create unique index venue_artist_ratings_artist_featured_rank_idx
  on venue_artist_ratings (artist_user_id, featured_by_artist_rank)
  where featured_by_artist_rank is not null;

create unique index venue_artist_ratings_venue_featured_rank_idx
  on venue_artist_ratings (venue_profile_id, featured_by_venue_rank)
  where featured_by_venue_rank is not null;
```
No RLS policies are added — this table already has none (all access goes through the service-role client, per the existing pattern documented in `CLAUDE.md`'s Mutual Ratings section).

`types/index.ts`'s `VenueArtistRatingRow` gains the two new fields.

## Setting Featured Picks

**New endpoints** (mirroring the existing artist/venue split used throughout ratings):
- `PUT /api/ratings/featured` — artist sets their featured list.
- `PUT /api/venue/ratings/featured` — venue sets their featured list.

**Request body:** `{ ratingIds: string[] }` — an ordered array of up to 3 `venue_artist_ratings.id` values, most-featured first. An empty array clears all featured picks.

**Server validation (service-role client):**
1. Reject if `ratingIds.length > 3`.
2. Reject if any id is duplicated.
3. For each id, look up the row and confirm: it belongs to the caller (`artist_user_id` = caller's user id, or `venue_profile_id` = caller's venue profile id) and it is revealed (both `*_rated_at` set). Reject the whole request if any id fails this check — same all-or-nothing validation style as the existing booking-requests accept path.
4. Write ranks 1..n to the given ids in array order; set `featured_by_artist_rank` (or `featured_by_venue_rank`) to `null` on every other row owned by the caller that currently has a rank set, so re-submitting cleanly replaces the previous picks in one request rather than requiring separate add/remove calls.

This "replace the whole list in one call" shape keeps the client simple: the UI always sends its full current selection rather than trying to diff adds/removes.

## Picking UI

On the artist's `/ratings` page and the venue's `/venue/ratings` page, the "Ratings you've given" section's `GivenRow` component already renders a small "Their rating" block showing the stars received (`app/(protected)/ratings/page.tsx:185-191`, duplicated at `app/venue/ratings/page.tsx:186-192`), guarded by `rating.revealed`. `rating.id` (the `venue_artist_ratings` row id) is already available on this object.

Add a "☆ Feature this review" / "★ Featured" toggle button next to that block:
- Clicking it calls the PUT endpoint with the caller's current full featured-id list plus/minus this id (added to the end when featuring, removed when un-featuring).
- If already at 3 featured and the user tries to add a 4th, show an inline message ("Un-feature one first — you can only feature up to 3") rather than silently bumping the oldest pick.
- Same per-row saving/error state pattern already used for the adjacent Edit/Report buttons on this row.

## Public Display

`components/ratings/RatingsSection.tsx` currently renders `data.reviews.map(...)` in whatever order the API returns (no sorting today). Two changes:

1. **Server-side ordering** (`app/api/public/artists/[id]/ratings/route.ts` and the venue equivalent): sort the row set so that explicitly-featured rows come first, in rank order, followed by all other revealed rows in their existing order. No new field is added to `PublicRatingsResponse` — ordering alone is sufficient, since the client only needs to know "first 3 vs rest."
2. **Client-side reveal** (`RatingsSection.tsx`): render `data.reviews.slice(0, 3)` by default. If `data.reviews.length > 3`, show a "Load more reviews" button below the visible ones; clicking it reveals `data.reviews.slice(3)` (already fetched — no second request). If `data.reviews.length <= 3`, no button, nothing hidden.

This means the "first 3, then load more" behavior works identically whether or not the reviewed party has explicitly picked favorites — an artist/venue who's never touched the feature just sees their reviews in the existing default order, split at 3, with no visible change in *content*, only in the load-more affordance once they have 4+.

## Edge Cases

- **Fewer than 3 revealed reviews total:** no "load more" button; nothing changes visually from today.
- **Un-featuring:** removing a pick from the middle (e.g. un-featuring rank 2 of 3) simply shifts the remaining picks — the next PUT call re-sends the remaining ids in order, which the server re-ranks 1..n.
- **A featured review's relationship somehow becomes un-revealed:** not possible under the current ratings design (reveal is one-directional once both `*_rated_at` are set; nothing un-sets them), so no cleanup logic is needed for this case.
