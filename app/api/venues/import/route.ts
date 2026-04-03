import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parseVenuesCsv } from "@/lib/csv-parser";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get the user's zone
  const { data: zone } = await supabase
    .from("zones")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!zone) {
    return NextResponse.json({ error: "No zone found for user" }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const csvText = await file.text();

  let venues;
  try {
    venues = parseVenuesCsv(csvText);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse CSV" },
      { status: 400 }
    );
  }

  if (venues.length === 0) {
    return NextResponse.json({ error: "No venues found in CSV" }, { status: 400 });
  }

  // Use service client to bypass RLS for bulk insert
  const serviceClient = await createServiceClient();

  const rows = venues.map((v) => ({
    ...v,
    zone_id: zone.id,
    user_id: user.id,
  }));

  const { data, error } = await serviceClient
    .from("venues")
    .insert(rows)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: data.length });
}
