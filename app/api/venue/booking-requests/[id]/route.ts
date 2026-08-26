// app/api/venue/booking-requests/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getOwnCompletedVenueProfile } from "@/lib/bookings/venue-auth";
import { sendCancellationEmail } from "@/lib/email/booking-request-notifications";
import { createNotification } from "@/lib/notifications/create";

// PATCH /api/venue/booking-requests/[id] — a venue withdraws a pending
// request or cancels an already-accepted booking. Body: { action: "cancel" }.
// A distinct body shape from the artist's accept/decline PATCH on
// /api/booking-requests/[id] (different file, different verb) rather than
// overloading `status` directly, so this endpoint can't be confused with
// that one.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (body.action !== "cancel") {
    return NextResponse.json({ error: "action must be 'cancel'" }, { status: 400 });
  }

  const venueProfile = await getOwnCompletedVenueProfile(supabase, user.id);
  if (!venueProfile) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const service = await createServiceClient();

  const { data: reqRow, error: fetchError } = await service
    .from("booking_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!reqRow) return NextResponse.json({ error: "Booking request not found" }, { status: 404 });
  if (reqRow.venue_profile_id !== venueProfile.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (reqRow.status === "declined" || reqRow.status === "cancelled") {
    return NextResponse.json({ error: "This booking can no longer be cancelled" }, { status: 409 });
  }

  const { data: updated, error: updateError } = await service
    .from("booking_requests")
    .update({ status: "cancelled", cancelled_by: "venue" })
    .eq("id", id)
    .in("status", ["pending", "accepted"])
    .select()
    .maybeSingle();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  if (!updated) {
    return NextResponse.json({ error: "This booking can no longer be cancelled" }, { status: 409 });
  }

  // Derived from the post-update row, not the earlier read — if the
  // request was accepted (gig created) in the window between that read
  // and this update, `updated.gig_id` still reflects it and the gig gets
  // cancelled too; deciding this from the stale pre-update row would miss
  // that race and leave an orphaned "upcoming" gig on the artist's side.
  const wasAccepted = Boolean(updated.gig_id);

  if (wasAccepted) {
    const { error: gigError } = await service
      .from("gigs")
      .update({ status: "cancelled" })
      .eq("id", updated.gig_id);
    if (gigError) console.error("PATCH /api/venue/booking-requests/[id]: failed to cancel linked gig", gigError);
  }

  try {
    await sendCancellationEmail(service, updated, "venue", wasAccepted);
  } catch (err) {
    console.error("PATCH /api/venue/booking-requests/[id]: failed to send cancellation email", err);
  }

  try {
    await createNotification(service, {
      userId: updated.artist_user_id,
      type: "booking_cancelled_by_venue",
      title: wasAccepted ? "A booking was cancelled" : "A booking request was withdrawn",
      link: "/calendar",
    });
  } catch (err) {
    console.error("PATCH /api/venue/booking-requests/[id]: failed to create notification", err);
  }

  return NextResponse.json(updated);
}
