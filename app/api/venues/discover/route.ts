import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Foursquare category IDs for live music / performance venues
// https://docs.foursquare.com/data-products/docs/categories
const FSQ_CATEGORIES = [
  "10032", // Music Venue
  "10033", // Jazz Club
  "10034", // Karaoke Bar (skip but included for broadness)
  "13003", // Bar (filtered by live music)
  "10035", // Concert Hall
  "10000", // Nightlife (parent — catches subvenues)
].join(",");

const FSQ_TYPE_MAP: Record<string, string> = {
  "10032": "venue",
  "10033": "bar",
  "10034": "bar",
  "10035": "venue",
  "10000": "club",
  "13003": "bar",
};

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const city   = searchParams.get("city")?.trim();
  const miles  = parseInt(searchParams.get("radius") ?? "25");
  const radius = Math.min(miles * 1609, 100000);

  if (!city) return NextResponse.json({ error: "city is required" }, { status: 400 });

  const apiKey = process.env.FOURSQUARE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Foursquare API key not configured" }, { status: 500 });

  const params = new URLSearchParams({
    near: city,
    categories: FSQ_CATEGORIES,
    radius: String(radius),
    limit: "50",
    sort: "RATING",
    fields: "name,location,tel,website,rating,stats,categories,fsq_id",
  });

  const fsqRes = await fetch(
    `https://api.foursquare.com/v3/places/search?${params}`,
    {
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!fsqRes.ok) {
    const err = await fsqRes.text();
    console.error("Foursquare error:", fsqRes.status, err.slice(0, 200));
    return NextResponse.json({ error: "Venue search failed — please try again." }, { status: 502 });
  }

  const fsqData = await fsqRes.json();

  // Get existing venue names to flag duplicates
  const { data: existingVenues } = await supabase
    .from("venues")
    .select("name")
    .eq("user_id", user.id);
  const existingNames = new Set((existingVenues ?? []).map((v) => v.name.toLowerCase().trim()));

  const results = (fsqData.results ?? []).map((b: any) => {
    const loc = b.location ?? {};
    const city2 = loc.locality ?? loc.region ?? null;
    const address = [loc.address, loc.address_extended].filter(Boolean).join(", ") || null;
    const fullAddress = address ? `${address}${city2 ? ", " + city2 : ""}` : null;
    const topCategory = b.categories?.[0]?.id ? String(b.categories[0].id) : "10032";
    const type = FSQ_TYPE_MAP[topCategory] ?? "venue";

    return {
      osm_id: b.fsq_id,
      name: b.name,
      type,
      city: city2,
      address: fullAddress,
      website: b.website ?? null,
      phone: b.tel ?? null,
      rating: b.rating ? Math.round(b.rating) / 2 : null, // FSQ rates 0-10, convert to 0-5
      review_count: b.stats?.total_ratings ?? 0,
      live_music_tagged: true,
      already_in_pipeline: existingNames.has(b.name.toLowerCase().trim()),
    };
  });

  return NextResponse.json({ results });
}
