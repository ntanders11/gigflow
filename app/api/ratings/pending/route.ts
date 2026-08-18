// app/api/ratings/pending/route.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getArtistPendingRelationships } from "@/lib/ratings/eligibility";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  try {
    const pending = await getArtistPendingRelationships(service, user.id);
    return NextResponse.json({ pending });
  } catch (err) {
    console.error("GET /api/ratings/pending failed", err);
    return NextResponse.json({ error: "Failed to load pending ratings" }, { status: 500 });
  }
}
