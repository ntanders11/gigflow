// app/api/venue/booking-requests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { sendNewBookingRequestEmail } from "@/lib/email/booking-request-notifications";
import { createNotification } from "@/lib/notifications/create";
import { VenueBookingRequestView } from "@/types";

async function getOwnCompletedVenueProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("venue_profiles")
    .select("id, venue_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || !data.venue_name) return null;
  return { id: data.id as string };
}

// Every request this venue has sent, with current status.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const venueProfile = await getOwnCompletedVenueProfile(supabase, user.id);
  if (!venueProfile) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const service = await createServiceClient();
  const { data: rows, error } = await service
    .from("booking_requests")
    .select("*")
    .eq("venue_profile_id", venueProfile.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const artistIds = [...new Set((rows ?? []).map((r) => r.artist_user_id as string))];
  const { data: artists } = await service
    .from("artist_profiles")
    .select("user_id, display_name, photo_url")
    .in("user_id", artistIds.length > 0 ? artistIds : [""]);
  const artistByUserId = new Map((artists ?? []).map((a) => [a.user_id as string, a]));

  const requests: VenueBookingRequestView[] = (rows ?? []).map((r): VenueBookingRequestView => {
    const artist = artistByUserId.get(r.artist_user_id as string);
    return {
      id: r.id,
      artist_name: (artist?.display_name as string | null) ?? "An artist",
      artist_photo_url: (artist?.photo_url as string | null) ?? null,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      message: r.message,
      status: r.status,
    };
  });

  return NextResponse.json({ requests });
}

// Creates a new request. Requires a completed venue account.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const venueProfile = await getOwnCompletedVenueProfile(supabase, user.id);
  if (!venueProfile) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { artist_user_id, date, start_time, end_time, message } = body;

  if (!artist_user_id || !date) {
    return NextResponse.json({ error: "artist_user_id and date are required" }, { status: 400 });
  }

  const service = await createServiceClient();

  const { data: targetArtist } = await service
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", artist_user_id)
    .maybeSingle();
  if (!targetArtist?.display_name) {
    return NextResponse.json({ error: "That artist could not be found" }, { status: 404 });
  }

  const { data: created, error } = await service
    .from("booking_requests")
    .insert({
      venue_profile_id: venueProfile.id,
      artist_user_id,
      date,
      start_time: start_time || null,
      end_time: end_time || null,
      message: message || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await sendNewBookingRequestEmail(service, created);
  } catch (err) {
    console.error("POST /api/venue/booking-requests: failed to send notification email", err);
  }

  try {
    await createNotification(service, {
      userId: created.artist_user_id,
      type: "booking_request_received",
      title: "New booking request",
      link: "/calendar",
    });
  } catch (err) {
    console.error("POST /api/venue/booking-requests: failed to create notification", err);
  }

  return NextResponse.json(created);
}
