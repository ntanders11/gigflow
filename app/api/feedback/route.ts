import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const MAX_LENGTH = 2000;
const MAX_PER_DAY = 5;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Please write something first." }, { status: 400 });
  if (message.length > MAX_LENGTH) {
    return NextResponse.json({ error: `Please keep it under ${MAX_LENGTH} characters.` }, { status: 400 });
  }

  // Service role: feedback has no client-facing RLS policies.
  const service = await createServiceClient();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await service
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_PER_DAY) {
    return NextResponse.json({ error: "That's a lot of feedback today — thank you! Try again tomorrow." }, { status: 429 });
  }

  const { data: venueProfile } = await service
    .from("venue_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = await service.from("feedback").insert({
    user_id: user.id,
    role: venueProfile ? "venue" : "artist",
    message,
  });
  if (error) {
    console.error("feedback insert failed:", error.message);
    return NextResponse.json({ error: "Couldn't send that — please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
