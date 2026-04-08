import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const city  = searchParams.get("city")?.trim();
  const miles = parseInt(searchParams.get("radius") ?? "25");
  const radiusMeters = Math.min(miles * 1609, 50000);

  if (!city) return NextResponse.json({ error: "city is required" }, { status: 400 });

  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "Geoapify API key not configured" }, { status: 500 });

  // 1. Geocode the city
  const geoRes = await fetch(
    `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(city)}&limit=1&apiKey=${apiKey}`,
    { signal: AbortSignal.timeout(6000) }
  );
  if (!geoRes.ok) return NextResponse.json({ error: "Location not found" }, { status: 404 });
  const geoData = await geoRes.json();
  if (!geoData.features?.length) return NextResponse.json({ error: "Location not found" }, { status: 404 });

  const [lon, lat] = geoData.features[0].geometry.coordinates;

  // 2. Search for live music / entertainment venues
  const categories = [
    "entertainment.music",
    "entertainment.nightclub",
    "entertainment.culture",
  ].join(",");

  const placesRes = await fetch(
    `https://api.geoapify.com/v2/places?categories=${categories}&filter=circle:${lon},${lat},${radiusMeters}&limit=50&apiKey=${apiKey}`,
    { signal: AbortSignal.timeout(8000) }
  );

  if (!placesRes.ok) {
    const err = await placesRes.text();
    console.error("Geoapify error:", placesRes.status, err.slice(0, 200));
    return NextResponse.json({ error: "Venue search failed — please try again." }, { status: 502 });
  }

  const placesData = await placesRes.json();

  // 3. Get existing venue names to flag duplicates
  const { data: existingVenues } = await supabase
    .from("venues")
    .select("name")
    .eq("user_id", user.id);
  const existingNames = new Set((existingVenues ?? []).map((v) => v.name.toLowerCase().trim()));

  // 4. Map results
  const seen = new Set<string>();
  const results = (placesData.features ?? [])
    .filter((f: any) => {
      const name = f.properties?.name;
      if (!name) return false;
      const key = name.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((f: any) => {
      const p = f.properties ?? {};
      const cats: string[] = p.categories ?? [];
      const type = cats.includes("entertainment.nightclub") ? "club"
        : cats.includes("entertainment.music") ? "venue"
        : "venue";

      return {
        osm_id: p.place_id ?? Math.random().toString(),
        name: p.name,
        type,
        city: p.city ?? p.town ?? p.village ?? null,
        address: p.formatted ?? p.address_line1 ?? null,
        website: p.website ?? null,
        phone: p.phone ?? null,
        rating: null,
        review_count: 0,
        live_music_tagged: true,
        already_in_pipeline: existingNames.has(p.name.toLowerCase().trim()),
      };
    });

  return NextResponse.json({ results });
}
