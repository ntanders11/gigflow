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
