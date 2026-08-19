import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { geocodeCity } from "@/lib/geocoding";

type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
  avg_rating: number | null;
  rating_count: number;
};

// Haversine distance in miles between two lat/lon points.
function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeGenre(g: string): string {
  return g.trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const city = req.nextUrl.searchParams.get("city")?.trim();
  if (!city) return NextResponse.json({ error: "city is required" }, { status: 400 });
  const parsedRadius = parseInt(req.nextUrl.searchParams.get("radius") ?? "30");
  const radiusMi = Number.isNaN(parsedRadius) || parsedRadius <= 0 ? 30 : parsedRadius;

  const googleKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const geoapifyKey = process.env.GEOAPIFY_API_KEY?.trim();

  const searchCoords = await geocodeCity(city, googleKey, geoapifyKey);
  if (!searchCoords) {
    return NextResponse.json({ error: "Location not found — try a different city or zip." }, { status: 400 });
  }

  // The requesting venue's own genres, for tiering results below. Read via
  // the venue's own RLS session — this is their own row, no service-role
  // needed.
  const { data: venueProfile } = await supabase
    .from("venue_profiles")
    .select("genres")
    .eq("user_id", user.id)
    .maybeSingle();
  const venueGenres = new Set((venueProfile?.genres ?? []).map(normalizeGenre));
  const venueHasGenres = venueGenres.size > 0;

  const service = await createServiceClient();

  // zones RLS scopes reads to the owning artist (auth.uid() = user_id), so
  // this cross-user read requires the service-role client — same reasoning
  // as every other cross-artist read in the venue-accounts feature before
  // this one.
  const { data: zones, error: zonesError } = await service
    .from("zones")
    .select("id, user_id, name, lat, lon, geocode_failed")
    .order("id")
    .limit(500);

  if (zonesError) return NextResponse.json({ error: zonesError.message }, { status: 500 });

  const alreadyCached = (zones ?? []).filter(
    (z): z is typeof z & { lat: number; lon: number } => z.lat != null && z.lon != null
  );
  // Zones that have never been geocoded AND haven't already been marked as
  // permanently failing — previously-failed zones are excluded here so they
  // stop being retried on every future search (see geocode_failed below).
  const needsGeocoding = (zones ?? []).filter((z) => z.lat == null && !z.geocode_failed);

  // Geocode zones missing cached coordinates, in fixed-size chunks rather
  // than one unbounded Promise.all — an uncapped burst could spike well
  // past Google Geocoding's shared 200-calls/day project-wide cap on the
  // very first search after this ships. Each successful geocode is written
  // back so no future search ever re-geocodes it; each failure is marked
  // geocode_failed so a permanently-unparseable zone name doesn't become a
  // standing, invisible drain on the same shared quota.
  const CHUNK_SIZE = 5;
  const newlyGeocoded: ({ user_id: string; lat: number; lon: number } | null)[] = [];
  for (let i = 0; i < needsGeocoding.length; i += CHUNK_SIZE) {
    const chunk = needsGeocoding.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (zone) => {
        const coords = await geocodeCity(zone.name, googleKey, geoapifyKey);
        if (!coords) {
          console.error("discover-artists: geocoding failed for zone", zone.id, zone.name);
          const { error: updateError } = await service
            .from("zones")
            .update({ geocode_failed: true })
            .eq("id", zone.id);
          if (updateError) {
            console.error("discover-artists: failed to mark zone as geocode_failed", updateError);
          }
          return null;
        }
        const { error: updateError } = await service
          .from("zones")
          .update({ lat: coords.lat, lon: coords.lon })
          .eq("id", zone.id);
        if (updateError) {
          console.error("discover-artists: failed to cache zone coordinates", updateError);
        }
        return { user_id: zone.user_id as string, lat: coords.lat, lon: coords.lon };
      })
    );
    newlyGeocoded.push(...chunkResults);
  }

  const zonesWithCoords = [
    ...alreadyCached.map((z) => ({ user_id: z.user_id as string, lat: z.lat, lon: z.lon })),
    ...newlyGeocoded.filter((z): z is { user_id: string; lat: number; lon: number } => z !== null),
  ];

  const nearbyUserIds = Array.from(
    new Set(
      zonesWithCoords
        .filter((z) => distanceMiles(searchCoords.lat, searchCoords.lon, z.lat, z.lon) <= radiusMi)
        .map((z) => z.user_id)
    )
  );

  if (nearbyUserIds.length === 0) {
    return NextResponse.json({ matchingGenre: [], other: [], venueHasGenres });
  }

  // artist_profiles already has a public-read RLS policy (the same one
  // that powers the public /profile/[id] page anyone can already view), so
  // this join goes through the venue's own ordinary session — no
  // service-role needed here, unlike the zones read above.
  const { data: artists, error: artistsError } = await supabase
    .from("artist_profiles")
    .select("user_id, display_name, genres, photo_url")
    .in("user_id", nearbyUserIds);

  if (artistsError) return NextResponse.json({ error: artistsError.message }, { status: 500 });

  const artistUserIdsForRatings = (artists ?? []).map((a) => a.user_id as string);
  // venue_artist_ratings has no client-facing RLS policies — this read MUST
  // use `service` (already in scope earlier in this file), not `supabase`
  // (the venue's own RLS session), or it will silently return zero rows.
  const { data: ratingRows } = await service
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

  const matchingGenre: ArtistResult[] = [];
  const other: ArtistResult[] = [];

  for (const artist of artists ?? []) {
    if (!artist.display_name) continue; // onboarding not complete — not a real artist yet
    const stars = ratingsByArtist.get(artist.user_id) ?? [];
    const result: ArtistResult = {
      user_id: artist.user_id,
      display_name: artist.display_name,
      genres: artist.genres ?? [],
      photo_url: artist.photo_url,
      avg_rating: stars.length > 0 ? stars.reduce((a, b) => a + b, 0) / stars.length : null,
      rating_count: stars.length,
    };
    const artistGenres = new Set(result.genres.map(normalizeGenre));
    const hasMatch = venueHasGenres && [...artistGenres].some((g) => venueGenres.has(g));
    (hasMatch ? matchingGenre : other).push(result);
  }

  return NextResponse.json({ matchingGenre, other, venueHasGenres });
}
