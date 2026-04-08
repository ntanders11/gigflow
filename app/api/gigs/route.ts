import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/gigs?venue_id=xxx
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const venueId = req.nextUrl.searchParams.get("venue_id");
  if (!venueId) return NextResponse.json({ error: "venue_id required" }, { status: 400 });

  const { data, error } = await supabase
    .from("gigs")
    .select("*")
    .eq("venue_id", venueId)
    .eq("user_id", user.id)
    .order("date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/gigs
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { venue_id, date, start_time, end_time, notes } = body;

  if (!venue_id || !date) {
    return NextResponse.json({ error: "venue_id and date are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("gigs")
    .insert({
      venue_id,
      user_id: user.id,
      date,
      start_time: start_time || null,
      end_time: end_time || null,
      notes: notes || null,
      status: "upcoming",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
