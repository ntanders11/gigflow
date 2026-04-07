import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, type, city, website, contact_name, contact_email, contact_phone, stage, confidence, notes } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Venue name is required" }, { status: 400 });
  }

  // Find or create a default zone for this user
  let { data: zone } = await supabase
    .from("zones")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!zone) {
    const { data: newZone } = await supabase
      .from("zones")
      .insert({ user_id: user.id, name: "Default", zip_code: null, radius_mi: 50 })
      .select("id")
      .single();
    zone = newZone;
  }

  const { data, error } = await supabase
    .from("venues")
    .insert({
      zone_id: zone!.id,
      user_id: user.id,
      name: name.trim(),
      type: type ?? null,
      city: city ?? null,
      website: website ?? null,
      contact_name: contact_name ?? null,
      contact_email: contact_email ?? null,
      contact_phone: contact_phone ?? null,
      stage: stage ?? "discovered",
      confidence: confidence ?? "MEDIUM",
      notes: notes ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
