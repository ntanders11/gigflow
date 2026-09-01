// app/api/venue/booking-requests/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getOwnCompletedVenueProfile } from "@/lib/bookings/venue-auth";
import { sendCancellationEmail, sendRescheduleEmail } from "@/lib/email/booking-request-notifications";
import { createNotification } from "@/lib/notifications/create";
import { isDateUnavailable } from "@/lib/bookings/availability";

// PATCH /api/venue/booking-requests/[id] — a venue withdraws a pending
// request, cancels an already-accepted booking, or edits its date/time.
// Body: { action: "cancel" } or { action: "edit", date, start_time?, end_time? }.
// A distinct body shape from the artist's accept/decline PATCH on
// /api/booking-requests/[id] (different file, different verb) rather than
// overloading `status` directly, so this endpoint can't be confused with
// that one.
//
// Only the venue can edit a booking's date/time, never the artist — the
// venue is the one who committed to that slot, so changing it is their
// call; the artist's own PATCH /api/gigs/[id] route rejects any attempt to
// change date/start_time/end_time on a gig linked back to one of these
// rows (see that route's own comment). The artist can still cancel it, or
// edit a gig they created themselves outside of any booking request — this
// restriction is specifically about who can move a venue's own booking.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (body.action !== "cancel" && body.action !== "edit") {
    return NextResponse.json({ error: "action must be 'cancel' or 'edit'" }, { status: 400 });
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
    return NextResponse.json({ error: "This booking can no longer be changed" }, { status: 409 });
  }

  if (body.action === "edit") {
    return handleEdit(service, reqRow, body);
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

// Handles { action: "edit" } — a venue changing the date/time of a
// booking they sent. `reqRow` is the pre-update row, already confirmed to
// belong to this venue and not declined/cancelled by the caller above.
async function handleEdit(
  service: SupabaseClient,
  reqRow: Record<string, unknown>,
  body: { date?: string; start_time?: string | null; end_time?: string | null }
) {
  if (!body.date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  // Only check availability when the date is actually changing — reusing
  // isDateUnavailable naively would false-positive against the booking's
  // own existing linked gig if the venue is only changing the time, since
  // that gig legitimately already occupies that date.
  if (body.date !== reqRow.date && await isDateUnavailable(service, reqRow.artist_user_id as string, body.date)) {
    return NextResponse.json({ error: "This artist isn't available on that date." }, { status: 400 });
  }

  // A booking's status here only ever reflects the request lifecycle
  // (pending/accepted) — nothing updates it when the linked gig later
  // gets marked completed or cancelled independently on the artist's
  // side, so that has to be checked separately before moving the date on
  // something that's already happened or been called off.
  if (reqRow.gig_id) {
    const { data: gig } = await service
      .from("gigs")
      .select("status")
      .eq("id", reqRow.gig_id as string)
      .maybeSingle();
    if (gig && gig.status !== "upcoming") {
      return NextResponse.json(
        { error: `This gig is already marked ${gig.status} and can't be rescheduled.` },
        { status: 409 }
      );
    }
  }

  const { data: updated, error: updateError } = await service
    .from("booking_requests")
    .update({
      date: body.date,
      start_time: body.start_time || null,
      end_time: body.end_time || null,
    })
    .eq("id", reqRow.id as string)
    .in("status", ["pending", "accepted"])
    .select()
    .maybeSingle();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  if (!updated) {
    return NextResponse.json({ error: "This booking can no longer be changed" }, { status: 409 });
  }

  // Only an accepted booking has a real gig on the artist's calendar to
  // keep in sync — a still-pending request has no linked gig yet, so
  // there's nothing else to update.
  if (updated.gig_id) {
    const { error: gigError } = await service
      .from("gigs")
      .update({
        date: updated.date,
        start_time: updated.start_time,
        end_time: updated.end_time,
      })
      .eq("id", updated.gig_id);
    if (gigError) console.error("PATCH /api/venue/booking-requests/[id]: failed to update linked gig", gigError);
  }

  try {
    await sendRescheduleEmail(service, updated);
  } catch (err) {
    console.error("PATCH /api/venue/booking-requests/[id]: failed to send reschedule email", err);
  }

  try {
    await createNotification(service, {
      userId: updated.artist_user_id,
      type: "booking_rescheduled",
      title: "A booking's date or time changed",
      link: "/calendar",
    });
  } catch (err) {
    console.error("PATCH /api/venue/booking-requests/[id]: failed to create reschedule notification", err);
  }

  return NextResponse.json(updated);
}
