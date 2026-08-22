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
): Promise<{ error: string; status: number } | { success: true }> {
  const rankColumn = RANK_COLUMN[party];
  const ownerColumn = OWNER_COLUMN[party];

  if (ratingIds.length > 3) {
    return { error: "You can feature at most 3 reviews", status: 400 };
  }
  if (new Set(ratingIds).size !== ratingIds.length) {
    return { error: "That list has a duplicate review in it", status: 400 };
  }

  if (ratingIds.length > 0) {
    const { data: rows, error } = await service
      .from("venue_artist_ratings")
      .select(`id, venue_rated_at, artist_rated_at, ${ownerColumn}`)
      .in("id", ratingIds);
    if (error) return { error: error.message, status: 500 };

    const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
    for (const id of ratingIds) {
      const row = byId.get(id) as Record<string, unknown> | undefined;
      if (!row) return { error: "One of these reviews no longer exists", status: 400 };
      if (row[ownerColumn] !== ownerId) {
        return { error: "You can only feature your own reviews", status: 403 };
      }
      const revealed = !!(row.venue_rated_at && row.artist_rated_at);
      if (!revealed) return { error: "You can only feature a review that's been revealed", status: 400 };
    }
  }

  // Clear ALL of the caller's currently-ranked rows first — including ones
  // staying in the new selection — so the second step below never collides
  // with a still-live rank on the partial unique index. See Task 2's
  // context note for why this order matters.
  const clearAll = () =>
    service
      .from("venue_artist_ratings")
      .update({ [rankColumn]: null })
      .eq(ownerColumn, ownerId)
      .not(rankColumn, "is", null);

  const { error: clearError } = await clearAll();
  if (clearError) return { error: clearError.message, status: 500 };

  for (let i = 0; i < ratingIds.length; i++) {
    const { error: writeError } = await service
      .from("venue_artist_ratings")
      .update({ [rankColumn]: i + 1 })
      .eq("id", ratingIds[i]);
    if (writeError) {
      // The documented failure guarantee is that a mid-loop failure leaves
      // the caller's featured picks cleared, not partially written. Best-
      // effort re-run of the same clear-all used above; if that ALSO fails,
      // log it but still surface the original write error to the caller —
      // a cleanup failure should never mask the real problem.
      const { error: cleanupError } = await clearAll();
      if (cleanupError) {
        console.error("setFeaturedRatings: cleanup after partial write failure also failed", cleanupError);
      }
      return { error: writeError.message, status: 500 };
    }
  }

  return { success: true };
}
