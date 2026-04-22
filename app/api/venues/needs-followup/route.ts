import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Returns venues that are eligible for a follow-up email:
// - stage = "contacted"
// - last_contacted_at >= 5 days ago
// - has a contact_email
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, type, city, contact_email, contact_name, last_contacted_at, user_id")
    .eq("user_id", user.id)
    .eq("stage", "contacted")
    .not("contact_email", "is", null)
    .lt("last_contacted_at", fiveDaysAgo)
    .order("last_contacted_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Filter out any that already received a follow-up interaction
  const venueIds = (venues ?? []).map((v) => v.id);
  if (venueIds.length === 0) return NextResponse.json({ venues: [] });

  const { data: existing } = await supabase
    .from("interactions")
    .select("venue_id")
    .in("venue_id", venueIds)
    .eq("type", "follow_up");

  const alreadySent = new Set((existing ?? []).map((i) => i.venue_id));
  const eligible = (venues ?? []).filter((v) => !alreadySent.has(v.id));

  return NextResponse.json({ venues: eligible });
}
