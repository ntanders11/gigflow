// lib/email/rating-notifications.ts
import { Resend } from "resend";
import { SupabaseClient } from "@supabase/supabase-js";
import { createNotification } from "@/lib/notifications/create";

async function sendSystemEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail) {
    console.error("rating-notifications: Resend not configured (missing API key or from address)");
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `StageReach <${fromEmail}>`,
    to,
    subject,
    text,
  });
  if (error) console.error("rating-notifications: send failed", error);
}

// Fired from PATCH /api/gigs/[id] the moment a gig transitions to
// "completed" on a linked venue. Guards against re-sending to a side
// that's already rated this relationship — without this check, a venue
// and artist who work together repeatedly would get "new gig to rate"
// on every subsequent completed gig even after the relationship was
// already fully rated (one rating per relationship, ever).
export async function maybeSendNewGigToRateEmails(
  service: SupabaseClient,
  opts: { artistUserId: string; venueId: string }
): Promise<void> {
  const { data: venue, error: venueError } = await service
    .from("venues")
    .select("venue_profile_id, name")
    .eq("id", opts.venueId)
    .maybeSingle();
  if (venueError) console.error("maybeSendNewGigToRateEmails: venues lookup failed", venueError);

  const venueProfileId = venue?.venue_profile_id as string | null;
  if (!venueProfileId) return; // not a linked venue — no rating opportunity exists at all

  const { data: existing, error: existingError } = await service
    .from("venue_artist_ratings")
    .select("artist_rated_at, venue_rated_at")
    .eq("venue_profile_id", venueProfileId)
    .eq("artist_user_id", opts.artistUserId)
    .maybeSingle();
  if (existingError) console.error("maybeSendNewGigToRateEmails: venue_artist_ratings lookup failed", existingError);

  const artistAlreadyRated = !!existing?.artist_rated_at;
  const venueAlreadyRated = !!existing?.venue_rated_at;
  if (artistAlreadyRated && venueAlreadyRated) return; // fully rated already — nothing new for either side

  const { data: venueProfile, error: venueProfileError } = await service
    .from("venue_profiles")
    .select("user_id, venue_name")
    .eq("id", venueProfileId)
    .maybeSingle();
  if (venueProfileError) console.error("maybeSendNewGigToRateEmails: venue_profiles lookup failed", venueProfileError);

  const venueName = (venueProfile?.venue_name as string | null) ?? venue?.name ?? "a venue";

  if (!artistAlreadyRated) {
    const { data: artistLogin, error: artistLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", opts.artistUserId)
      .maybeSingle();
    if (artistLoginError) console.error("maybeSendNewGigToRateEmails: profiles (artist login email) lookup failed", artistLoginError);
    if (artistLogin?.email) {
      await sendSystemEmail(
        artistLogin.email as string,
        "You have a new gig to rate on StageReach",
        `Your gig at ${venueName} is marked completed. Head to your Ratings page on StageReach to rate them — you'll see their rating of you once you've both submitted.`
      );
    }
    try {
      await createNotification(service, {
        userId: opts.artistUserId,
        type: "rating_available",
        title: "You have a new gig to rate",
        body: `Your gig at ${venueName} is marked completed.`,
        link: "/ratings",
      });
    } catch (err) {
      console.error("maybeSendNewGigToRateEmails: failed to create artist notification", err);
    }
  }

  if (!venueAlreadyRated && venueProfile?.user_id) {
    const { data: artistProfile, error: artistProfileError } = await service
      .from("artist_profiles")
      .select("display_name")
      .eq("user_id", opts.artistUserId)
      .maybeSingle();
    if (artistProfileError) console.error("maybeSendNewGigToRateEmails: artist_profiles lookup failed", artistProfileError);
    const artistName = (artistProfile?.display_name as string | null) ?? "an artist";

    const { data: venueLogin, error: venueLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", venueProfile.user_id as string)
      .maybeSingle();
    if (venueLoginError) console.error("maybeSendNewGigToRateEmails: profiles (venue login email) lookup failed", venueLoginError);
    if (venueLogin?.email) {
      await sendSystemEmail(
        venueLogin.email as string,
        "You have a new artist to rate on StageReach",
        `Your gig with ${artistName} is marked completed. Head to your Ratings page on StageReach to rate them — you'll see their rating of you once you've both submitted.`
      );
    }
    try {
      await createNotification(service, {
        userId: venueProfile.user_id as string,
        type: "rating_available",
        title: "You have a new artist to rate",
        body: `Your gig with ${artistName} is marked completed.`,
        link: "/venue/ratings",
      });
    } catch (err) {
      console.error("maybeSendNewGigToRateEmails: failed to create venue notification", err);
    }
  }
}

// Fired from inside POST /api/ratings and POST /api/venue/ratings, only when
// this specific submission was the one that caused the SECOND half to fill
// in. Notifies only whichever side had already submitted and was waiting —
// `justSubmittedBy` tells it which side to skip.
export async function sendRatingRevealedEmail(
  service: SupabaseClient,
  rating: { venue_profile_id: string; artist_user_id: string },
  justSubmittedBy: "artist" | "venue"
): Promise<void> {
  const { data: venueProfile, error: venueProfileError } = await service
    .from("venue_profiles")
    .select("user_id, venue_name")
    .eq("id", rating.venue_profile_id)
    .maybeSingle();
  if (venueProfileError) console.error("sendRatingRevealedEmail: venue_profiles lookup failed", venueProfileError);

  if (justSubmittedBy === "venue") {
    // Artist was already waiting — notify them.
    const { data: artistLogin, error: artistLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", rating.artist_user_id)
      .maybeSingle();
    if (artistLoginError) console.error("sendRatingRevealedEmail: profiles (artist login email) lookup failed", artistLoginError);
    if (artistLogin?.email) {
      const venueName = (venueProfile?.venue_name as string | null) ?? "A venue";
      await sendSystemEmail(
        artistLogin.email as string,
        `${venueName} revealed their rating of you`,
        `Both ratings are in — head to your Ratings page on StageReach to see it.`
      );
    }
  } else {
    // Venue was already waiting — notify them.
    if (!venueProfile?.user_id) return;
    const { data: artistProfile, error: artistProfileError } = await service
      .from("artist_profiles")
      .select("display_name")
      .eq("user_id", rating.artist_user_id)
      .maybeSingle();
    if (artistProfileError) console.error("sendRatingRevealedEmail: artist_profiles lookup failed", artistProfileError);
    const { data: venueLogin, error: venueLoginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", venueProfile.user_id as string)
      .maybeSingle();
    if (venueLoginError) console.error("sendRatingRevealedEmail: profiles (venue login email) lookup failed", venueLoginError);
    if (venueLogin?.email) {
      const artistName = (artistProfile?.display_name as string | null) ?? "An artist";
      await sendSystemEmail(
        venueLogin.email as string,
        `${artistName} revealed their rating of you`,
        `Both ratings are in — head to your Ratings page on StageReach to see it.`
      );
    }
  }
}
