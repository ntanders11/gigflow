import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { toPhotoViews } from "@/lib/promo-photos/server";

// A venue can see an artist's promo photos only while it has an ACCEPTED
// booking with that artist. Anything else (never booked, request still
// pending, declined, cancelled) gets a 403 — the photos aren't public.
export async function GET(_req: Request, { params }: { params: Promise<{ artistUserId: string }> }) {
  const { artistUserId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();

  const { data: venue } = await service
    .from("venue_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!venue) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: booking } = await service
    .from("booking_requests")
    .select("id")
    .eq("venue_profile_id", venue.id)
    .eq("artist_user_id", artistUserId)
    .eq("status", "accepted")
    .limit(1)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: rows } = await service
    .from("artist_promo_photos")
    .select("id, storage_path, file_name")
    .eq("user_id", artistUserId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  return NextResponse.json({ photos: await toPhotoViews(service, rows ?? []) });
}
