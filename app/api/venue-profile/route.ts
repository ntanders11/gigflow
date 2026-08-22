import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeMatchKey, escapeIlike } from "@/lib/venues/matching";

// Creates the blank venue_profiles row immediately after a venue account
// is authenticated (venue_name left null). This placeholder is what lets
// the app tell "a venue mid-signup" apart from "an artist mid-signup"
// everywhere else — see proxy.ts. Called once, right after
// supabase.auth.signUp() succeeds, from the /venues/signup wizard.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: existing } = await supabase
    .from("venue_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) return NextResponse.json(existing);

  // An already-authenticated artist landing on /venues/signup (e.g. just
  // clicking around while logged in) must not silently become a venue too
  // — a real StageReach account was found with both an artist_profiles AND
  // a venue_profiles row this way, permanently mis-routing every future
  // login for that account into the venue side. Block it here instead.
  const { data: artistProfile } = await supabase
    .from("artist_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (artistProfile) {
    return NextResponse.json(
      { error: "This is already an artist account — sign out first to create a separate venue account." },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("venue_profiles")
    .insert({ user_id: user.id })
    .select()
    .single();

  if (error) {
    // Two concurrent POSTs (double-click, retried request) can both pass
    // the "existing row" check above before either insert lands, so the
    // second insert hits the unique(user_id) constraint. Treat that as the
    // same "already exists" case rather than surfacing a raw 500.
    if (error.code === "23505") {
      const { data: existingRow } = await supabase
        .from("venue_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (existingRow) return NextResponse.json(existingRow);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("venue_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const {
    venue_name, address, city, venue_type,
    contact_email, contact_phone, description,
    genres, stage_equipment, photo_url,
  } = body;

  const { data: current } = await supabase
    .from("venue_profiles")
    .select("venue_name")
    .eq("user_id", user.id)
    .single();

  const isFirstTimeNamed = !current?.venue_name && !!venue_name;

  const { data, error } = await supabase
    .from("venue_profiles")
    .update({
      ...(venue_name !== undefined && { venue_name }),
      ...(address !== undefined && { address }),
      ...(city !== undefined && { city }),
      ...(venue_type !== undefined && { venue_type }),
      ...(contact_email !== undefined && { contact_email }),
      ...(contact_phone !== undefined && { contact_phone }),
      ...(description !== undefined && { description }),
      ...(genres !== undefined && { genres }),
      ...(stage_equipment !== undefined && { stage_equipment }),
      ...(photo_url !== undefined && { photo_url }),
    })
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    // Postgres unique_violation — someone else claimed/created this exact
    // (venue_name, city) pair first. Same message as the search-time
    // "already claimed" case, since from the venue's perspective it's the
    // identical situation, just discovered a moment later than usual.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This venue already has an account — reach out if that's a mistake." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (isFirstTimeNamed) {
    await runLinkingSweep(data.id, data.venue_name as string, data.city);
  }

  return NextResponse.json(data);
}

// Finds every artist's `venues` row matching this venue's name + city
// (the same normalization used by the search endpoint) and sets
// venue_profile_id on all of them — not just whichever row happened to
// surface during search. Writes across other artists' private rows, so
// this goes through the service-role client, same pattern as the
// existing CSV import route uses for cross-user writes; RLS on `venues`
// would otherwise block it entirely. `city` is deliberately `string | null`
// here, not `string` — gating this on city being present was an earlier
// mistake caught in plan review: a venue that signs up without entering a
// city would otherwise never get linked at all, silently breaking the
// badge for exactly that case. `normalizeMatchKey` already treats a null
// city as an empty string on both sides of the comparison, so this just
// works without a special case.
async function runLinkingSweep(venueProfileId: string, venueName: string, city: string | null) {
  const service = await createServiceClient();
  const key = normalizeMatchKey(venueName, city);

  const { data: candidates, error: candidatesError } = await service
    .from("venues")
    .select("id, name, city")
    .ilike("name", escapeIlike(venueName))
    .is("venue_profile_id", null)
    .limit(200);

  if (candidatesError) {
    console.error("runLinkingSweep: failed to fetch candidate venues", candidatesError);
    return;
  }

  const matchingIds = (candidates ?? [])
    .filter((v) => normalizeMatchKey(v.name, v.city) === key)
    .map((v) => v.id);

  if (matchingIds.length === 0) return;

  const { error: updateError } = await service
    .from("venues")
    .update({ venue_profile_id: venueProfileId })
    .in("id", matchingIds);

  if (updateError) {
    console.error("runLinkingSweep: failed to update venue_profile_id on matched venues", updateError);
  }
}
