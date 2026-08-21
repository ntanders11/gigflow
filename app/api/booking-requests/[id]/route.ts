// app/api/booking-requests/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureLinkedBookedVenue } from "@/lib/bookings/pipeline";
import { sendBookingResponseEmail } from "@/lib/email/booking-request-notifications";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { status } = body;
  if (status !== "accepted" && status !== "declined") {
    return NextResponse.json({ error: "status must be 'accepted' or 'declined'" }, { status: 400 });
  }

  const service = await createServiceClient();

  const { data: reqRow, error: fetchError } = await service
    .from("booking_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!reqRow) return NextResponse.json({ error: "Booking request not found" }, { status: 404 });
  if (reqRow.artist_user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Only act on a still-pending request, checked only after confirming
  // this artist owns it (booking_requests carries no RLS policies of its
  // own, so ownership must be verified here) — reject re-accepting or
  // re-declining one that's already been responded to. This first check
  // is a plain read, not a lock; the two conditional updates below (each
  // re-checking status = "pending" at write time) are what actually
  // close the race if two requests for the same row arrive concurrently.
  if (reqRow.status !== "pending") {
    return NextResponse.json({ error: "This request has already been responded to" }, { status: 409 });
  }

  if (status === "declined") {
    const { data: updated, error: updateError } = await service
      .from("booking_requests")
      .update({ status: "declined" })
      .eq("id", id)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    if (!updated) {
      return NextResponse.json({ error: "This request has already been responded to" }, { status: 409 });
    }

    try {
      await sendBookingResponseEmail(service, updated, "declined");
    } catch (err) {
      console.error("PATCH /api/booking-requests: failed to send decline email", err);
    }
    return NextResponse.json(updated);
  }

  // status === "accepted"
  const linkResult = await ensureLinkedBookedVenue(service, {
    artistUserId: user.id,
    venueProfileId: reqRow.venue_profile_id,
  });
  if ("error" in linkResult) {
    return NextResponse.json({ error: linkResult.error }, { status: 500 });
  }

  const { data: gig, error: gigError } = await service
    .from("gigs")
    .insert({
      venue_id: linkResult.venueId,
      user_id: user.id,
      date: reqRow.date,
      start_time: reqRow.start_time,
      end_time: reqRow.end_time,
      notes: reqRow.message,
      status: "upcoming",
    })
    .select()
    .single();
  if (gigError) return NextResponse.json({ error: gigError.message }, { status: 500 });

  const { data: updated, error: updateError } = await service
    .from("booking_requests")
    .update({ status: "accepted", gig_id: gig.id })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  if (!updated) {
    // Lost a race with a concurrent PATCH on the same request — the gig
    // we just created is now orphaned (nothing references it), so remove
    // it rather than leave a duplicate on the artist's calendar.
    const { error: cleanupError } = await service.from("gigs").delete().eq("id", gig.id);
    if (cleanupError) {
      console.error("PATCH /api/booking-requests: failed to clean up orphaned gig after lost race", cleanupError);
    }
    return NextResponse.json({ error: "This request has already been responded to" }, { status: 409 });
  }

  try {
    await sendBookingResponseEmail(service, updated, "accepted");
  } catch (err) {
    console.error("PATCH /api/booking-requests: failed to send accept email", err);
  }

  return NextResponse.json(updated);
}
