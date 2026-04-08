import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const lat  = parseFloat(searchParams.get("lat") ?? "");
  const lon  = parseFloat(searchParams.get("lon") ?? "");
  const miles = parseInt(searchParams.get("radius") ?? "25");
  const radiusMeters = Math.min(miles * 1609, 50000);

  if (isNaN(lat) || isNaN(lon)) return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });

  const clauses = [
    `node["live_music"="yes"]`,
    `way["live_music"="yes"]`,
    `node["amenity"="music_venue"]`,
    `way["amenity"="music_venue"]`,
    `node["amenity"="nightclub"]`,
    `way["amenity"="nightclub"]`,
    `node["amenity"="concert_hall"]`,
    `way["amenity"="concert_hall"]`,
  ].map((c) => `${c}(around:${radiusMeters},${lat},${lon});`);

  const query = `[out:json][timeout:8];\n(\n${clauses.join("\n")}\n);\nout body center;`;
  const encoded = `data=${encodeURIComponent(query)}`;

  const MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ];

  let opData: any = null;
  for (const mirror of MIRRORS) {
    try {
      const r = await fetch(mirror, {
        method: "POST",
        body: encoded,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(7000),
      });
      if (r.ok) { opData = await r.json(); break; }
    } catch { /* try next */ }
  }

  if (!opData) {
    return NextResponse.json({ error: "Search unavailable — please try again." }, { status: 502 });
  }

  const { data: existingVenues } = await supabase
    .from("venues")
    .select("name")
    .eq("user_id", user.id);
  const existingNames = new Set((existingVenues ?? []).map((v) => v.name.toLowerCase().trim()));

  const TYPE_MAP: Record<string, string> = {
    bar: "bar", pub: "bar", nightclub: "club", music_venue: "venue",
    concert_hall: "venue", brewery: "brewery", winery: "winery",
    restaurant: "restaurant", arts_centre: "venue",
  };

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
      const amenity = tags.amenity || tags.craft || "";
      const type = TYPE_MAP[amenity] ?? "venue";
      const city2 = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || null;
      const street = tags["addr:street"]
        ? `${tags["addr:housenumber"] ? tags["addr:housenumber"] + " " : ""}${tags["addr:street"]}`
        : null;
      const address = street ? `${street}${city2 ? ", " + city2 : ""}` : null;

      return {
        osm_id: String(el.id),
        name: tags.name,
        type,
        city: city2,
        address,
        website: tags.website || tags["contact:website"] || null,
        phone: tags.phone || tags["contact:phone"] || null,
        rating: null,
        review_count: 0,
        live_music_tagged: true,
        already_in_pipeline: existingNames.has(tags.name.toLowerCase().trim()),
      };
    })
    .slice(0, 80);

  return NextResponse.json({ results });
}
