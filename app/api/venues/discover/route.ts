import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Yelp categories that are specifically live music / performance venues
const YELP_CATEGORIES = [
  "musicvenues",
  "jazzandblues",
  "piano_bars",
  "countrydancehalls",
  "danceclubs",
  "comedyclubs",
  "concerthalls",
].join(",");

const YELP_CATEGORY_TO_TYPE: Record<string, string> = {
  musicvenues: "venue",
  jazzandblues: "bar",
  piano_bars: "bar",
  countrydancehalls: "venue",
  danceclubs: "club",
  comedyclubs: "venue",
  concerthalls: "venue",
  bars: "bar",
  breweries: "brewery",
  wineries: "winery",
  wine_bars: "winery",
  brewpubs: "brewery",
};

function inferType(categories: { alias: string }[]): string {
  for (const cat of categories) {
    const t = YELP_CATEGORY_TO_TYPE[cat.alias];
    if (t) return t;
  }
  return "venue";
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const city   = searchParams.get("city")?.trim();
  const miles  = parseInt(searchParams.get("radius") ?? "25");
  const radius = Math.min(miles * 1609, 40000); // Yelp max is 40,000m

  if (!city) return NextResponse.json({ error: "city is required" }, { status: 400 });

  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Yelp API key not configured" }, { status: 500 });

  // Search Yelp for live music venue categories
  const params = new URLSearchParams({
    location: city,
    categories: YELP_CATEGORIES,
    radius: String(radius),
    limit: "50",
    sort_by: "rating",
  });

  const yelpRes = await fetch(
    `https://api.yelp.com/v3/businesses/search?${params}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!yelpRes.ok) {
    const err = await yelpRes.text();
    console.error("Yelp error:", yelpRes.status, err.slice(0, 200));
    return NextResponse.json({ error: "Venue search failed — please try again." }, { status: 502 });
  }

  const yelpData = await yelpRes.json();

  // Get existing venue names to flag duplicates
  const { data: existingVenues } = await supabase
    .from("venues")
    .select("name")
    .eq("user_id", user.id);
  const existingNames = new Set((existingVenues ?? []).map((v) => v.name.toLowerCase().trim()));

  const results = (yelpData.businesses ?? [])
    .filter((b: any) => !b.is_closed)
    .map((b: any) => {
      const loc = b.location ?? {};
      const city2 = loc.city ?? null;
      const address = [loc.address1, loc.address2].filter(Boolean).join(", ") || null;
      const fullAddress = address ? `${address}${city2 ? ", " + city2 : ""}` : null;

      return {
        osm_id: b.id, // reusing field name for compat with UI
        name: b.name,
        type: inferType(b.categories ?? []),
        city: city2,
        address: fullAddress,
        website: b.url ?? null, // Yelp page URL
        phone: b.display_phone ?? null,
        rating: b.rating ?? null,
        review_count: b.review_count ?? 0,
        live_music_tagged: true, // all Yelp results here are music-specific categories
        already_in_pipeline: existingNames.has(b.name.toLowerCase().trim()),
      };
    });

  return NextResponse.json({ results });
}
