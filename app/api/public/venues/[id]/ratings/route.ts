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
