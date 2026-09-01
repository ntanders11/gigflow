import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Every blackout range the logged-in artist has set, soonest first.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("artist_blackout_dates")
    .select("id, start_date, end_date, note")
    .eq("user_id", user.id)
    .order("start_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ blackoutDates: data ?? [] });
}

// Creates a new blackout range. Never blocked by an existing booking on
// the same dates — just returns a non-blocking `warning` if one exists,
// so the artist knows without the range creation failing.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { start_date, end_date, note } = body;

  if (!start_date || !end_date) {
    return NextResponse.json({ error: "start_date and end_date are required" }, { status: 400 });
  }
  if (end_date < start_date) {
    return NextResponse.json({ error: "End date must be on or after the start date" }, { status: 400 });
  }

  const { data: created, error } = await supabase
    .from("artist_blackout_dates")
    .insert({ user_id: user.id, start_date, end_date, note: note || null })
    .select("id, start_date, end_date, note")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // booking_requests has no RLS policies of its own (see
  // supabase/migrations/019_booking_requests.sql's header comment) — a
  // read through the ordinary `supabase` client above would silently
  // return nothing rather than error, making this conflict check a
  // silent no-op. Needs the service-role client.
  const service = await createServiceClient();
  const { data: conflicts } = await service
    .from("booking_requests")
    .select("date")
    .eq("artist_user_id", user.id)
    .in("status", ["pending", "accepted"])
    .gte("date", start_date)
    .lte("date", end_date);

  let warning: string | undefined;
  if (conflicts && conflicts.length > 0) {
    warning = conflicts.length === 1
      ? `You already have a booking on ${conflicts[0].date} — this won't cancel it, but nothing new can be booked in this range.`
      : `You already have ${conflicts.length} bookings in this range — they won't be cancelled, but nothing new can be booked in this range.`;
  }

  return NextResponse.json({ ...created, warning });
}
