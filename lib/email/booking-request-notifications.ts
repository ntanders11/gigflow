// lib/email/booking-request-notifications.ts
import { Resend } from "resend";
import { SupabaseClient } from "@supabase/supabase-js";

async function sendSystemEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail) {
    console.error("booking-request-notifications: Resend not configured (missing API key or from address)");
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `StageReach <${fromEmail}>`,
    to,
    subject,
    text,
  });
  if (error) console.error("booking-request-notifications: send failed", error);
}

// Fired from POST /api/venue/booking-requests right after a request is created.
export async function sendNewBookingRequestEmail(
  service: SupabaseClient,
  request: { artist_user_id: string; venue_profile_id: string; date: string }
): Promise<void> {
  const { data: artistLogin, error: artistError } = await service
    .from("profiles")
    .select("email")
    .eq("id", request.artist_user_id)
    .maybeSingle();
  if (artistError) console.error("sendNewBookingRequestEmail: artist profile lookup failed", artistError);
  if (!artistLogin?.email) return;

  const { data: venueProfile, error: venueError } = await service
    .from("venue_profiles")
    .select("venue_name")
    .eq("id", request.venue_profile_id)
    .maybeSingle();
  if (venueError) console.error("sendNewBookingRequestEmail: venue profile lookup failed", venueError);

  const venueName = (venueProfile?.venue_name as string | null) ?? "A venue";

  await sendSystemEmail(
    artistLogin.email as string,
    "You have a new booking request on StageReach",
    `${venueName} requested to book you for ${request.date}. Head to your Booking Calendar on StageReach to accept or decline.`
  );
}

// Fired from PATCH /api/booking-requests/[id] right after the artist responds.
export async function sendBookingResponseEmail(
  service: SupabaseClient,
  request: { venue_profile_id: string; artist_user_id: string; date: string },
  status: "accepted" | "declined"
): Promise<void> {
  const { data: venueProfile, error: venueError } = await service
    .from("venue_profiles")
    .select("user_id, venue_name")
    .eq("id", request.venue_profile_id)
    .maybeSingle();
  if (venueError) console.error("sendBookingResponseEmail: venue profile lookup failed", venueError);
  if (!venueProfile?.user_id) return;

  const { data: venueLogin, error: loginError } = await service
    .from("profiles")
    .select("email")
    .eq("id", venueProfile.user_id as string)
    .maybeSingle();
  if (loginError) console.error("sendBookingResponseEmail: venue login lookup failed", loginError);
  if (!venueLogin?.email) return;

  const { data: artistProfile, error: artistError } = await service
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", request.artist_user_id)
    .maybeSingle();
  if (artistError) console.error("sendBookingResponseEmail: artist profile lookup failed", artistError);

  const artistName = (artistProfile?.display_name as string | null) ?? "The artist";

  if (status === "accepted") {
    await sendSystemEmail(
      venueLogin.email as string,
      "Your booking request was accepted",
      `${artistName} accepted your booking request for ${request.date}. It's on the calendar!`
    );
  } else {
    await sendSystemEmail(
      venueLogin.email as string,
      "Your booking request was declined",
      `${artistName} declined your booking request for ${request.date}.`
    );
  }
}

// Fired from either cancellation route (venue cancelling, or the artist
// cancelling their gig) right after the booking_requests row is updated
// to status: "cancelled". `wasAccepted` controls wording only — a
// cancelled *pending* request reads as "withdrawn", a cancelled
// *accepted* one reads as "cancelled", since the artist already has it on
// their calendar in the second case.
export async function sendCancellationEmail(
  service: SupabaseClient,
  request: { venue_profile_id: string; artist_user_id: string; date: string },
  cancelledBy: "artist" | "venue",
  wasAccepted: boolean
): Promise<void> {
  const { data: venueProfile, error: venueError } = await service
    .from("venue_profiles")
    .select("user_id, venue_name")
    .eq("id", request.venue_profile_id)
    .maybeSingle();
  if (venueError) console.error("sendCancellationEmail: venue profile lookup failed", venueError);

  const { data: artistProfile, error: artistError } = await service
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", request.artist_user_id)
    .maybeSingle();
  if (artistError) console.error("sendCancellationEmail: artist profile lookup failed", artistError);

  const venueName = (venueProfile?.venue_name as string | null) ?? "The venue";
  const artistName = (artistProfile?.display_name as string | null) ?? "The artist";
  const verb = wasAccepted ? "cancelled" : "withdrawn";

  if (cancelledBy === "venue") {
    const { data: artistLogin, error: loginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", request.artist_user_id)
      .maybeSingle();
    if (loginError) console.error("sendCancellationEmail: artist login lookup failed", loginError);
    if (!artistLogin?.email) return;

    await sendSystemEmail(
      artistLogin.email as string,
      wasAccepted ? "A booking was cancelled" : "A booking request was withdrawn",
      `${venueName} ${verb} the booking for ${request.date}.`
    );
  } else {
    if (!venueProfile?.user_id) return;
    const { data: venueLogin, error: loginError } = await service
      .from("profiles")
      .select("email")
      .eq("id", venueProfile.user_id as string)
      .maybeSingle();
    if (loginError) console.error("sendCancellationEmail: venue login lookup failed", loginError);
    if (!venueLogin?.email) return;

    await sendSystemEmail(
      venueLogin.email as string,
      "A booking was cancelled",
      `${artistName} cancelled the booking for ${request.date}.`
    );
  }
}
