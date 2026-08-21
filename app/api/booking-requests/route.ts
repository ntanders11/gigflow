// app/api/booking-requests/route.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Every PENDING request addressed to this artist.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const { data: rows, error } = await service
    .from("booking_requests")
    .select("*")
    .eq("artist_user_id", user.id)
    .eq("status", "pending")
    .order("date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const venueIds = [...new Set((rows ?? []).map((r) => r.venue_profile_id as string))];
  const { data: venues } = await service
    .from("venue_profiles")
    .select("id, venue_name, photo_url")
    .in("id", venueIds.length > 0 ? venueIds : [""]);
  const venueById = new Map((venues ?? []).map((v) => [v.id as string, v]));

  const pending = (rows ?? []).map((r) => {
    const venue = venueById.get(r.venue_profile_id as string);
    return {
      id: r.id,
      venue_name: (venue?.venue_name as string | null) ?? "A venue",
      venue_photo_url: (venue?.photo_url as string | null) ?? null,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      message: r.message,
    };
  });

  return NextResponse.json({ pending });
}
