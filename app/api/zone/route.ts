import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: zone } = await supabase
    .from("zones")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ zone });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = (body.name ?? "").trim();
  const zipCode = (body.zip_code ?? "").trim();
  const radiusMi = Number(body.radius_mi);

  if (!name) {
    return NextResponse.json({ error: "City is required" }, { status: 400 });
  }
  if (!Number.isFinite(radiusMi) || radiusMi < 1) {
    return NextResponse.json({ error: "Radius must be a positive number" }, { status: 400 });
  }

  const { data: existingZone } = await supabase
    .from("zones")
    .select("id, name, zip_code")
    .eq("user_id", user.id)
    .maybeSingle();

  // A changed city/zip invalidates any cached lat/lon (see
  // app/api/venues/discover-artists/route.ts) — reset it so the next venue
  // search re-geocodes the new location instead of matching against the old
  // one. geocode_failed resets too, since a previously-bad zip may have just
  // been corrected.
  const locationChanged =
    !existingZone || existingZone.name !== name || (existingZone.zip_code ?? "") !== zipCode;

  const payload = {
    name,
    zip_code: zipCode || null,
    radius_mi: radiusMi,
    ...(locationChanged ? { lat: null, lon: null, geocode_failed: false } : {}),
  };

  const { data: zone, error } = existingZone
    ? await supabase.from("zones").update(payload).eq("id", existingZone.id).select().single()
    : await supabase.from("zones").insert({ user_id: user.id, ...payload }).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ zone });
}
