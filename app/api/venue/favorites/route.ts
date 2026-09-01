// app/api/venue/favorites/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buildArtistResults } from "@/lib/venues/artist-results";

// The venue's own favorited artists, as full ArtistResult objects (same
// shape Discover Artists returns) — every entry here is favorited by
// definition, so the Set passed to buildArtistResults is just "all of them".
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: favoriteRows, error } = await supabase
    .from("venue_favorites")
    .select("artist_user_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const artistUserIds = (favoriteRows ?? []).map((r) => r.artist_user_id as string);
  const favoritedIds = new Set(artistUserIds);

  const service = await createServiceClient();
  let favorites;
  try {
    favorites = await buildArtistResults(supabase, service, artistUserIds, favoritedIds);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load favorites" }, { status: 500 });
  }

  return NextResponse.json({ favorites });
}

// Saves an artist to the venue's favorites. Idempotent: favoriting an
// already-favorited artist is a harmless no-op, never an error — a
// double-tap or a stale UI state should never surface a scary message
// for something this low-stakes.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { artist_user_id } = body;
  if (!artist_user_id) {
    return NextResponse.json({ error: "artist_user_id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("venue_favorites")
    .insert({ user_id: user.id, artist_user_id });

  // Postgres unique_violation — already favorited. Treat as success.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
