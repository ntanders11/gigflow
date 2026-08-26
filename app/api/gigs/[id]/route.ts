import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { maybeSendNewGigToRateEmails } from "@/lib/email/rating-notifications";
import { sendCancellationEmail } from "@/lib/email/booking-request-notifications";
import { createNotification } from "@/lib/notifications/create";

// PATCH /api/gigs/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // A gig linked to a venue's booking request can only have its
  // date/time moved by the venue (via PATCH /api/venue/booking-requests/
  // [id], action "edit") — the venue committed to that slot, so changing
  // it is their call, not the artist's. Only checked when the PATCH
  // actually touches one of these fields, so the common case (status
  // changes, checklist toggles, notes) skips the extra lookup entirely.
  // This mirrors the justCancelled lookup below: booking_requests carries
  // no client-facing RLS, so it needs the service-role client to read.
  const touchesDateOrTime = "date" in body || "start_time" in body || "end_time" in body;
  if (touchesDateOrTime) {
    const service = await createServiceClient();
    const { data: linkedRequest } = await service
      .from("booking_requests")
      .select("id")
      .eq("gig_id", id)
      .maybeSingle();
    if (linkedRequest) {
      return NextResponse.json(
        { error: "This gig's date and time can only be changed by the venue that booked it." },
        { status: 403 }
      );
    }
  }

  // Read the prior status before the update — the notification below only
  // fires on an actual transition INTO "completed", not on every PATCH
  // that happens to include status: "completed" again.
  const { data: before } = await supabase
    .from("gigs")
    .select("status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("gigs")
    .update(body)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const justCompleted = before?.status !== "completed" && data.status === "completed";
  if (justCompleted) {
    // venue_artist_ratings has no client-facing RLS policies (see
    // supabase/migrations/018_venue_artist_ratings.sql) — a read through
    // the ordinary `supabase` client above would silently return nothing
    // rather than error, making the re-fire guard inside
    // maybeSendNewGigToRateEmails a no-op. Must use the service-role
    // client for this side-effect, kept deliberately separate from the
    // RLS-scoped client used for the security-relevant gig update above.
    const service = await createServiceClient();
    try {
      await maybeSendNewGigToRateEmails(service, {
        artistUserId: user.id,
        venueId: data.venue_id,
      });
    } catch (err) {
      console.error("PATCH /api/gigs/[id]: failed to send new-gig-to-rate emails", err);
    }
  }

  const justCancelled = before?.status !== "cancelled" && data.status === "cancelled";
  if (justCancelled) {
    // booking_requests carries no client-facing RLS policies either (same
    // reasoning as above) — a gig only has a linked booking_requests row
    // if it originated from an accepted booking request (gig_id is set
    // there, never the other way around), so most cancelled gigs will
    // find nothing here and that's fine, not an error case.
    const service = await createServiceClient();
    const { data: linkedRequest, error: lookupError } = await service
      .from("booking_requests")
      .select("*")
      .eq("gig_id", id)
      .maybeSingle();
    if (lookupError) {
      console.error("PATCH /api/gigs/[id]: failed to look up linked booking request", lookupError);
    } else if (linkedRequest && linkedRequest.status !== "declined" && linkedRequest.status !== "cancelled") {
      const { data: updatedRequest, error: cancelError } = await service
        .from("booking_requests")
        .update({ status: "cancelled", cancelled_by: "artist" })
        .eq("id", linkedRequest.id)
        .select()
        .maybeSingle();
      if (cancelError) {
        console.error("PATCH /api/gigs/[id]: failed to cancel linked booking request", cancelError);
      } else if (updatedRequest) {
        try {
          await sendCancellationEmail(service, updatedRequest, "artist", true);
        } catch (err) {
          console.error("PATCH /api/gigs/[id]: failed to send cancellation email", err);
        }
        try {
          const { data: venueProfile } = await service
            .from("venue_profiles")
            .select("user_id")
            .eq("id", updatedRequest.venue_profile_id)
            .maybeSingle();
          if (venueProfile?.user_id) {
            await createNotification(service, {
              userId: venueProfile.user_id as string,
              type: "booking_cancelled_by_artist",
              title: "A booking was cancelled",
              link: "/venue/bookings",
            });
          }
        } catch (err) {
          console.error("PATCH /api/gigs/[id]: failed to create cancellation notification", err);
        }
      }
    }
  }

  return NextResponse.json(data);
}

// DELETE /api/gigs/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same reasoning as the date/time guard in PATCH above — a hard delete
  // would silently unlink the venue's booking_requests row (its gig_id
  // just goes null on delete) without cancelling it or telling the venue.
  // The artist should cancel a venue-originated gig instead, which does
  // both properly.
  const service = await createServiceClient();
  const { data: linkedRequest } = await service
    .from("booking_requests")
    .select("id")
    .eq("gig_id", id)
    .maybeSingle();
  if (linkedRequest) {
    return NextResponse.json(
      { error: "This gig came from a venue booking request — cancel it instead so the venue is notified." },
      { status: 403 }
    );
  }

  const { error } = await supabase
    .from("gigs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
