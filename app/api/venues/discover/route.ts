import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TYPE_OVERPASS: Record<string, string[]> = {
  bar:        ['node["amenity"="bar"]', 'way["amenity"="bar"]', 'node["amenity"="pub"]', 'way["amenity"="pub"]'],
  restaurant: ['node["amenity"="restaurant"]', 'way["amenity"="restaurant"]'],
  cafe:       ['node["amenity"="cafe"]', 'way["amenity"="cafe"]'],
  brewery:    ['node["craft"="brewery"]', 'way["craft"="brewery"]', 'node["amenity"="brewery"]'],
  winery:     ['node["craft"="winery"]', 'way["craft"="winery"]', 'node["amenity"="winery"]'],
  club:       ['node["amenity"="nightclub"]', 'way["amenity"="nightclub"]'],
  hotel:      ['node["tourism"="hotel"]', 'way["tourism"="hotel"]'],
  venue:      ['node["amenity"="events_venue"]', 'way["amenity"="events_venue"]', 'node["amenity"="arts_centre"]'],
};

const OSM_TO_GIGFLOW_TYPE: Record<string, string> = {
  bar: "bar", pub: "bar", restaurant: "restaurant", cafe: "cafe",
  brewery: "brewery", winery: "winery", nightclub: "club",
  hotel: "hotel", events_venue: "venue", arts_centre: "venue",
};

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const city    = searchParams.get("city")?.trim();
  const radius  = parseInt(searchParams.get("radius") ?? "10") * 1609; // miles → meters
  const types   = searchParams.get("types")?.split(",").filter(Boolean) ?? Object.keys(TYPE_OVERPASS);

  if (!city) return NextResponse.json({ error: "city is required" }, { status: 400 });

  // 1. Geocode city → lat/lon
  const geoRes = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
    { headers: { "User-Agent": "GigFlow/1.0 (taylorandersonmusic.com)" } }
  );
  const geoData = await geoRes.json();
  if (!geoData.length) return NextResponse.json({ error: "Location not found" }, { status: 404 });

  const lat = parseFloat(geoData[0].lat);
  const lon = parseFloat(geoData[0].lon);

  // 2. Build Overpass query
  const lines: string[] = [];
  for (const t of types) {
    const clauses = TYPE_OVERPASS[t] ?? [];
    for (const clause of clauses) {
      lines.push(`${clause}(around:${radius},${lat},${lon});`);
    }
  }
  const query = `[out:json][timeout:30];\n(\n${lines.join("\n")}\n);\nout center tags;`;

  const opRes = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
    headers: { "Content-Type": "text/plain" },
  });
  if (!opRes.ok) return NextResponse.json({ error: "Overpass API error" }, { status: 502 });

  const opData = await opRes.json();

  // 3. Get user's existing venue names for dedup
  const { data: existingVenues } = await supabase
    .from("venues")
    .select("name")
    .eq("user_id", user.id);
  const existingNames = new Set((existingVenues ?? []).map((v) => v.name.toLowerCase().trim()));

  // 4. Map results
  const seen = new Set<string>();
  const results = (opData.elements ?? [])
    .filter((el: any) => {
      const name = el.tags?.name;
      if (!name) return false;
      const key = name.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((el: any) => {
      const tags = el.tags ?? {};
      const amenity = tags.amenity || tags.craft || tags.tourism || "";
      const type = OSM_TO_GIGFLOW_TYPE[amenity] ?? "venue";
      const lat2 = el.lat ?? el.center?.lat;
      const lon2 = el.lon ?? el.center?.lon;
      const city2 = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || null;
      const address = tags["addr:street"]
        ? `${tags["addr:housenumber"] ? tags["addr:housenumber"] + " " : ""}${tags["addr:street"]}${city2 ? ", " + city2 : ""}`
        : null;

      return {
        osm_id: String(el.id),
        name: tags.name,
        type,
        city: city2,
        address,
        website: tags.website || tags["contact:website"] || null,
        phone: tags.phone || tags["contact:phone"] || null,
        lat: lat2,
        lon: lon2,
        already_in_pipeline: existingNames.has(tags.name.toLowerCase().trim()),
      };
    })
    .slice(0, 80); // cap at 80 results

  return NextResponse.json({ results, geocoded: { lat, lon, label: geoData[0].display_name } });
}
