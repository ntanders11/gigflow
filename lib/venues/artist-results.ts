import { SupabaseClient } from "@supabase/supabase-js";

export type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
  avg_rating: number | null;
  rating_count: number;
  favorited: boolean;
};

// Builds full ArtistResult objects for a set of artist_profiles rows,
// joining in each artist's mutual-rating average and whether the calling
// venue has favorited them. Shared by GET /api/venues/discover-artists
// and GET /api/venue/favorites so both surfaces compute ratings and
// favorited-status identically — they can't quietly drift apart.
export async function buildArtistResults(
  supabase: SupabaseClient,  // RLS-scoped — artist_profiles has a public-read policy
  service: SupabaseClient,   // service-role — venue_artist_ratings has no policies of its own
  artistUserIds: string[],
  favoritedIds: Set<string>
): Promise<ArtistResult[]> {
  if (artistUserIds.length === 0) return [];

  const { data: artists, error: artistsError } = await supabase
    .from("artist_profiles")
    .select("user_id, display_name, genres, photo_url")
    .in("user_id", artistUserIds);
  if (artistsError) throw new Error(artistsError.message);

  const { data: ratingRows } = await service
    .from("venue_artist_ratings")
    .select("artist_user_id, venue_stars")
    .in("artist_user_id", artistUserIds)
    .not("venue_rated_at", "is", null)
    .not("artist_rated_at", "is", null);

  const ratingsByArtist = new Map<string, number[]>();
  for (const row of ratingRows ?? []) {
    const list = ratingsByArtist.get(row.artist_user_id as string) ?? [];
    list.push(row.venue_stars as number);
    ratingsByArtist.set(row.artist_user_id as string, list);
  }

  const results: ArtistResult[] = [];
  for (const artist of artists ?? []) {
    if (!artist.display_name) continue; // onboarding not complete — not a real artist yet
    const artistUserId = artist.user_id as string;
    const stars = ratingsByArtist.get(artistUserId) ?? [];
    results.push({
      user_id: artistUserId,
      display_name: artist.display_name as string,
      genres: (artist.genres as string[] | null) ?? [],
      photo_url: artist.photo_url as string | null,
      avg_rating: stars.length > 0 ? stars.reduce((a, b) => a + b, 0) / stars.length : null,
      rating_count: stars.length,
      favorited: favoritedIds.has(artistUserId),
    });
  }

  // .in() does not guarantee the query preserves artistUserIds' order, so
  // sort explicitly — callers (the favorites list, in particular) rely on
  // getting results back in the order they asked for.
  const orderIndex = new Map(artistUserIds.map((id, i) => [id, i]));
  results.sort((a, b) => (orderIndex.get(a.user_id) ?? 0) - (orderIndex.get(b.user_id) ?? 0));

  return results;
}
