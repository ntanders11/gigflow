import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeMatchKey, dedupeMatchableVenues } from "@/lib/venues/matching";

// Searches across EVERY artist's private `venues` pipeline rows (not
// just one artist's) to help a signing-up venue find themselves. RLS on
// `venues` scopes reads to auth.uid() = user_id, so a venue account has
// no way to read another artist's rows directly — this requires the
// service-role client, same as the CSV import route uses for bulk
// cross-user writes. Only public-safe fields are ever selected or
// returned: name, city, address, type. Never contact info, notes,
// pipeline stage, confidence, or which artist owns the relationship.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const city = req.nextUrl.searchParams.get("city")?.trim() || null;

  const service = await createServiceClient();

  const { data: pipelineMatches, error: pipelineError } = await service
    .from("venues")
    .select("name, city, address, type")
    .ilike("name", `%${name}%`);

  if (pipelineError) return NextResponse.json({ error: pipelineError.message }, { status: 500 });

  const deduped = dedupeMatchableVenues(pipelineMatches ?? []);

  const { data: claimedProfiles, error: profilesError } = await service
    .from("venue_profiles")
    .select("venue_name, city")
    .not("venue_name", "is", null)
    .ilike("venue_name", `%${name}%`);

  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  const claimedKeys = new Set(
    (claimedProfiles ?? []).map((p) => normalizeMatchKey(p.venue_name as string, p.city))
  );

  const candidates = deduped.map((row) => ({
    name: row.name,
    city: row.city,
    address: row.address,
    venue_type: row.type,
    status: claimedKeys.has(normalizeMatchKey(row.name, row.city)) ? "taken" as const : "claimable" as const,
  }));

  // If the venue's own name+city is already claimed but has no matching
  // pipeline row at all (e.g. someone created a fresh profile with no
  // prior pipeline entry), still surface it as taken so a second person
  // can't attempt to "create fresh" under the same identity.
  if (city && claimedKeys.has(normalizeMatchKey(name, city)) &&
      !candidates.some((c) => normalizeMatchKey(c.name, c.city) === normalizeMatchKey(name, city))) {
    candidates.push({ name, city, address: null, venue_type: null, status: "taken" });
  }

  return NextResponse.json({ candidates });
}
