// app/api/ratings/featured/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { setFeaturedRatings } from "@/lib/ratings/featured";

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const ratingIds = Array.isArray(body.ratingIds) ? body.ratingIds : null;
  if (!ratingIds || ratingIds.some((id: unknown) => typeof id !== "string")) {
    return NextResponse.json({ error: "ratingIds must be an array of strings" }, { status: 400 });
  }

  const service = await createServiceClient();
  const result = await setFeaturedRatings(service, "artist", user.id, ratingIds);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ success: true });
}
