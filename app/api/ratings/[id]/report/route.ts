// app/api/ratings/[id]/report/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { Resend } from "resend";

type ReportableRating = {
  id: string;
  venue_profile_id: string;
  artist_user_id: string;
  venue_stars: number | null;
  venue_review: string | null;
  venue_rated_at: string | null;
  artist_stars: number | null;
  artist_review: string | null;
  artist_rated_at: string | null;
};

// Builds a Supabase Studio SQL Editor deep link pre-filled with a query
// selecting exactly this row — Studio's `content` query param prefills the
// editor, so this is a genuine "go straight to this row" link, not just a
// pointer at the table in general. Falls back to null if the project ref
// can't be parsed out of the Supabase URL (shouldn't happen in practice).
function buildRowLink(ratingId: string): string | null {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const match = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!match) return null;
  const projectRef = match[1];
  const query = `select * from venue_artist_ratings where id = '${ratingId}';`;
  return `https://supabase.com/dashboard/project/${projectRef}/sql/new?content=${encodeURIComponent(query)}`;
}

async function notifyTaylorOfReport(
  rating: ReportableRating,
  reporterUserId: string,
  reason: string | null
): Promise<void> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail) {
    console.error("report route: Resend not configured, skipping notification email");
    return;
  }
  const rowLink = buildRowLink(rating.id);
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `StageReach <${fromEmail}>`,
    to: fromEmail,
    subject: "A rating was reported on StageReach",
    text: [
      `Rating ${rating.id} was reported by user ${reporterUserId}.`,
      `Reason: ${reason ?? "(none given)"}`,
      "",
      `Venue's rating: ${rating.venue_stars ?? "(not yet given)"} stars`,
      rating.venue_review ? `Venue's review: ${rating.venue_review}` : "Venue's review: (none)",
      "",
      `Artist's rating: ${rating.artist_stars ?? "(not yet given)"} stars`,
      rating.artist_review ? `Artist's review: ${rating.artist_review}` : "Artist's review: (none)",
      "",
      rowLink ? `View/remove this row: ${rowLink}` : "Look this row up directly in Supabase (venue_artist_ratings table) to review and remove if warranted.",
    ].join("\n"),
  });
  if (error) console.error("report route: failed to send notification email", error);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 2000) : null;

  const service = await createServiceClient();
  const { data: rating, error } = await service
    .from("venue_artist_ratings")
    .select("id, venue_profile_id, artist_user_id, venue_stars, venue_review, venue_rated_at, artist_stars, artist_review, artist_rated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rating) return NextResponse.json({ error: "Rating not found" }, { status: 404 });

  // Only reportable once revealed — the UI only ever shows a Report link
  // after reveal, and the server enforces the same rule so a rating can't
  // be reported before the reporter has actually seen it.
  const revealed = !!(rating.venue_rated_at && rating.artist_rated_at);
  if (!revealed) return NextResponse.json({ error: "This rating hasn't been revealed yet" }, { status: 403 });

  const isArtistParty = rating.artist_user_id === user.id;
  let isVenueParty = false;
  if (!isArtistParty) {
    const { data: venueProfile } = await service
      .from("venue_profiles")
      .select("user_id")
      .eq("id", rating.venue_profile_id)
      .maybeSingle();
    isVenueParty = venueProfile?.user_id === user.id;
  }
  if (!isArtistParty && !isVenueParty) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error: insertError } = await service
    .from("venue_artist_rating_reports")
    .insert({ rating_id: rating.id, reporter_user_id: user.id, reason });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  try {
    await notifyTaylorOfReport(rating as ReportableRating, user.id, reason);
  } catch (err) {
    console.error("report route: failed to send notification email", err);
  }

  return NextResponse.json({ success: true });
}
