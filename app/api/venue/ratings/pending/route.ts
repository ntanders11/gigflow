// app/api/venue/ratings/pending/route.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getVenuePendingRelationships } from "@/lib/ratings/eligibility";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: venueProfile } = await supabase
    .from("venue_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!venueProfile) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });

  const service = await createServiceClient();
  try {
    const pending = await getVenuePendingRelationships(service, venueProfile.id as string);
    return NextResponse.json({ pending });
  } catch (err) {
    console.error("GET /api/venue/ratings/pending failed", err);
    return NextResponse.json({ error: "Failed to load pending ratings" }, { status: 500 });
  }
}
