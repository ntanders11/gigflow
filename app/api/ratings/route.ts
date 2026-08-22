// app/api/ratings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { validateQualifyingGig } from "@/lib/ratings/eligibility";
import { sendRatingRevealedEmail } from "@/lib/email/rating-notifications";
import { RatingView } from "@/types";

async function shapeRow(
  service: SupabaseClient,
  row: {
    id: string; venue_profile_id: string; artist_user_id: string;
    venue_stars: number | null; venue_review: string | null; venue_rated_at: string | null;
    artist_stars: number | null; artist_review: string | null; artist_rated_at: string | null;
    featured_by_artist_rank: number | null; featured_by_venue_rank: number | null;
  }
): Promise<RatingView> {
  const revealed = !!(row.venue_rated_at && row.artist_rated_at);
  const { data: venueProfile } = await service
    .from("venue_profiles")
    .select("venue_name, photo_url")
    .eq("id", row.venue_profile_id)
    .maybeSingle();

  return {
    id: row.id,
    venue_profile_id: row.venue_profile_id,
    artist_user_id: row.artist_user_id,
    revealed,
    my_stars: row.artist_stars ?? 0,
    my_review: row.artist_review,
    their_stars: revealed ? row.venue_stars : null,
    their_review: revealed ? row.venue_review : null,
    counterpart_name: (venueProfile?.venue_name as string | null) ?? "A venue",
    counterpart_photo_url: (venueProfile?.photo_url as string | null) ?? null,
    featured_rank: row.featured_by_artist_rank,
  };
}

// Every relationship this artist has rated (their half always present, the
// venue's half once revealed) — powers the "Ratings you've given" section.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const { data: rows, error } = await service
    .from("venue_artist_ratings")
    .select("*")
    .eq("artist_user_id", user.id)
    .not("artist_rated_at", "is", null)
    .order("artist_rated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const shaped = await Promise.all((rows ?? []).map((r) => shapeRow(service, r)));
  return NextResponse.json({ ratings: shaped });
}

// Submit or edit the artist's half of a relationship. First submission
// requires qualifying_gig_id and passes it through validateQualifyingGig;
// edits (the row already exists) don't need it again.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { venue_profile_id, stars, review, qualifying_gig_id } = body;

  if (!venue_profile_id || typeof stars !== "number" || stars < 1 || stars > 5) {
    return NextResponse.json({ error: "venue_profile_id and stars (1-5) are required" }, { status: 400 });
  }

  const service = await createServiceClient();

  const { data: existing, error: existingError } = await service
    .from("venue_artist_ratings")
    .select("*")
    .eq("venue_profile_id", venue_profile_id)
    .eq("artist_user_id", user.id)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  if (!existing) {
    if (!qualifying_gig_id) {
      return NextResponse.json({ error: "qualifying_gig_id is required for a first rating" }, { status: 400 });
    }
    try {
      const validation = await validateQualifyingGig(service, {
        gigId: qualifying_gig_id,
        venueProfileId: venue_profile_id,
        artistUserId: user.id,
      });
      if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 403 });
    } catch (err) {
      console.error("POST /api/ratings: validateQualifyingGig threw", err);
      return NextResponse.json({ error: "Failed to validate the gig for this rating" }, { status: 500 });
    }
  }

  const wasRevealedBefore = !!(existing?.venue_rated_at && existing?.artist_rated_at);
  const now = new Date().toISOString();

  const { data: saved, error: saveError } = await service
    .from("venue_artist_ratings")
    .upsert(
      {
        venue_profile_id,
        artist_user_id: user.id,
        ...(existing ? {} : { qualifying_gig_id }),
        artist_stars: stars,
        artist_review: review ?? null,
        artist_rated_at: now,
      },
      { onConflict: "venue_profile_id,artist_user_id" }
    )
    .select()
    .single();

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  const nowRevealed = !!(saved.venue_rated_at && saved.artist_rated_at);
  if (nowRevealed && !wasRevealedBefore) {
    try {
      await sendRatingRevealedEmail(service, saved, "artist");
    } catch (err) {
      console.error("POST /api/ratings: failed to send reveal email", err);
    }
  }

  return NextResponse.json(await shapeRow(service, saved));
}
