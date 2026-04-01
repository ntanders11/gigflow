import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// GET /api/invoices?venue_id=xxx — list invoices for a venue
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const venueId = request.nextUrl.searchParams.get("venue_id");
  if (!venueId) return NextResponse.json({ error: "venue_id required" }, { status: 400 });

  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("venue_id", venueId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/invoices — create a new invoice (draft, not sent yet)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { venue_id, amount_cents, payment_type, event_date, package_label, description } = body;

  if (!venue_id || !amount_cents) {
    return NextResponse.json({ error: "venue_id and amount_cents are required" }, { status: 400 });
  }

  const serviceClient = await createServiceClient();
  const { data, error } = await serviceClient
    .from("invoices")
    .insert({
      venue_id,
      user_id: user.id,
      amount_cents,
      payment_type: payment_type ?? "full",
      event_date: event_date ?? null,
      package_label: package_label ?? null,
      description: description ?? null,
      status: "draft",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
