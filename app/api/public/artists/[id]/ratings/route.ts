// app/api/public/artists/[id]/ratings/route.ts
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
    .select("venue_profile_id, venue_stars, venue_review, featured_by_artist_rank")
    .eq("artist_user_id", id)
    .not("venue_rated_at", "is", null)
    .not("artist_rated_at", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sortedRows = [...(rows ?? [])].sort((a, b) => {
    const rankA = a.featured_by_artist_rank as number | null;
    const rankB = b.featured_by_artist_rank as number | null;
    if (rankA !== null && rankB !== null) return rankA - rankB;
    if (rankA !== null) return -1;
    if (rankB !== null) return 1;
    return 0;
  });

  const venueIds = sortedRows.map((r) => r.venue_profile_id as string);
  const { data: venues } = await service
    .from("venue_profiles")
    .select("id, venue_name, photo_url")
    .in("id", venueIds.length > 0 ? venueIds : [""]);
  const venueById = new Map((venues ?? []).map((v) => [v.id as string, v]));

  const reviews = sortedRows.map((r) => {
    const venue = venueById.get(r.venue_profile_id as string);
    return {
      reviewer_id: r.venue_profile_id as string,
      reviewer_name: (venue?.venue_name as string | null) ?? "Venue",
      reviewer_photo_url: (venue?.photo_url as string | null) ?? null,
      stars: r.venue_stars as number,
      review: r.venue_review as string | null,
    };
  });

  const count = reviews.length;
  const average = count > 0 ? reviews.reduce((sum, r) => sum + r.stars, 0) / count : null;

  const response: PublicRatingsResponse = { average, count, reviews };
  return NextResponse.json(response);
}
