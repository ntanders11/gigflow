import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Map Geoapify categories → our simplified type labels
const GEOAPIFY_TYPE_MAP: Record<string, string> = {
  "catering.bar": "bar",
  "catering.pub": "bar",
  "adult.nightclub": "club",
  "production.brewery": "brewery",
  "production.winery": "winery",
};

// Map legacy Overpass/OSM types
const OSM_TYPE_MAP: Record<string, string> = {
  bar: "bar", pub: "bar", nightclub: "club", music_venue: "venue",
  concert_hall: "venue", brewery: "brewery", winery: "winery",
  restaurant: "restaurant", arts_centre: "venue",
};

type DiscoverResult = {
  osm_id: string;
  name: string;
  type: string;
  city: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  rating: number | null;
  review_count: number;
  live_music_tagged: boolean;
  already_in_pipeline: boolean;
};

// Geocode a city/zip string. Geoapify first (free, same account as venue
// search below), falling back to Nominatim (also free, US-restricted) if
// Geoapify is unavailable for any reason.
async function geocodeCity(
  city: string,
  geoapifyKey: string | undefined
): Promise<{ lat: number; lon: number } | null> {
  if (geoapifyKey) {
    try {
      const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(city)}&filter=countrycode:us&limit=1&apiKey=${geoapifyKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = await res.json();
        const coords = data.features?.[0]?.geometry?.coordinates;
        if (coords) return { lat: coords[1], lon: coords[0] };
      }
    } catch { /* fall through to Nominatim */ }
  }

  // Nominatim fallback — countrycodes=us keeps it from matching
  // small localities in unexpected countries/states.
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url, {
      headers: { "User-Agent": "StageReach/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data[0]) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch { /* give up */ }

  return null;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const cityParam = searchParams.get("city");
  const miles     = parseInt(searchParams.get("radius") ?? "25");
  const radiusMeters = Math.min(miles * 1609, 50000);

  const geoapifyKey = process.env.GEOAPIFY_API_KEY?.trim();

  // Support legacy lat/lon params so old clients don't break,
  // but prefer the new city-based approach (geocoding server-side).
  let lat: number, lon: number;
  const latParam = parseFloat(searchParams.get("lat") ?? "");
  const lonParam = parseFloat(searchParams.get("lon") ?? "");

  if (!isNaN(latParam) && !isNaN(lonParam)) {
    lat = latParam;
    lon = lonParam;
  } else if (cityParam) {
    const coords = await geocodeCity(cityParam, geoapifyKey);
    if (!coords) {
      return NextResponse.json({ error: "Location not found — try a different city or zip." }, { status: 400 });
    }
    lat = coords.lat;
    lon = coords.lon;
  } else {
    return NextResponse.json({ error: "city or lat/lon is required" }, { status: 400 });
  }

  // Load existing venue names for de-dupe
  const { data: existingVenues } = await supabase
    .from("venues")
    .select("name")
    .eq("user_id", user.id);
  const existingNames = new Set((existingVenues ?? []).map((v: { name: string }) => v.name.toLowerCase().trim()));

  // ── 1. Try Geoapify Places (free tier, no billing required) ────────────────
  if (geoapifyKey) {
    try {
      const results = await searchWithGeoapify(lat, lon, radiusMeters, geoapifyKey, existingNames);
      if (results.length > 0) {
        return NextResponse.json({ results });
      }
    } catch (err) {
      console.error("Geoapify search failed:", err);
    }
  }

  // ── 2. Overpass fallback ───────────────────────────────────────────────────
  try {
    const results = await searchWithOverpass(lat, lon, radiusMeters, existingNames);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Search unavailable — please try again." }, { status: 502 });
  }
}

// ── Geoapify Places search ───────────────────────────────────────────────────
async function searchWithGeoapify(
  lat: number,
  lon: number,
  radiusMeters: number,
  apiKey: string,
  existingNames: Set<string>,
): Promise<DiscoverResult[]> {
  // Deliberately scoped to small, informal venues — the kind a musician can
  // walk into and pitch for a regular gig slot. Explicitly NOT the generic
  // "entertainment" category (pulls in museums, cinemas, bowling alleys) and
  // NOT theatre/arts_centre either — those surfaced university auditoriums
  // and city park amphitheaters, which book through totally different
  // channels than a bar or club does.
  const categories = [
    "catering.bar",
    "catering.pub",
    "adult.nightclub",
    "production.brewery",
    "production.winery",
  ].join(",");

  const url = `https://api.geoapify.com/v2/places?categories=${categories}&filter=circle:${lon},${lat},${radiusMeters}&limit=50&apiKey=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Geoapify places error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const seen = new Set<string>();
  const results: DiscoverResult[] = [];

  for (const feature of data.features ?? []) {
    const p = feature.properties ?? {};
    const name: string = p.name ?? "";
    if (!name || seen.has(p.place_id)) continue;
    seen.add(p.place_id);

    const cats: string[] = p.categories ?? [];
    let mappedType = "venue";
    for (const c of cats) {
      if (GEOAPIFY_TYPE_MAP[c]) { mappedType = GEOAPIFY_TYPE_MAP[c]; break; }
    }

    results.push({
      osm_id: p.place_id ?? `${p.lat},${p.lon}`,
      name,
      type: mappedType,
      city: p.city ?? p.town ?? p.village ?? null,
      address: p.formatted ?? p.address_line1 ?? null,
      website: p.website ?? null,
      phone: p.phone ?? p.contact?.phone ?? null,
      rating: null,
      review_count: 0,
      live_music_tagged: false,
      already_in_pipeline: existingNames.has(name.toLowerCase().trim()),
    });
  }

  return results.slice(0, 80);
}

// ── OpenStreetMap Overpass fallback ──────────────────────────────────────────
async function searchWithOverpass(
  lat: number,
  lon: number,
  radiusMeters: number,
  existingNames: Set<string>,
): Promise<DiscoverResult[]> {
  // Cast a wider net: live music tags + common venue amenities
  const tags = [
    `node["live_music"="yes"]`,
    `way["live_music"="yes"]`,
    `node["amenity"="music_venue"]`,
    `way["amenity"="music_venue"]`,
    `node["amenity"="nightclub"]`,
    `way["amenity"="nightclub"]`,
    `node["amenity"="concert_hall"]`,
    `way["amenity"="concert_hall"]`,
    `node["amenity"="bar"]`,
    `way["amenity"="bar"]`,
    `node["amenity"="pub"]`,
    `way["amenity"="pub"]`,
    `node["craft"="brewery"]`,
    `way["craft"="brewery"]`,
    `node["craft"="winery"]`,
    `way["craft"="winery"]`,
  ].map((c) => `${c}(around:${radiusMeters},${lat},${lon});`);

  const query = `[out:json][timeout:12];\n(\n${tags.join("\n")}\n);\nout body center;`;
  const encoded = `data=${encodeURIComponent(query)}`;

  const MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ];

  let opData: { elements?: unknown[] } | null = null;
  for (const mirror of MIRRORS) {
    try {
      const r = await fetch(mirror, {
        method: "POST",
        body: encoded,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) { opData = await r.json(); break; }
    } catch { /* try next */ }
  }

  if (!opData) throw new Error("Overpass unavailable");

  const seen = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (opData.elements ?? []).filter((el: any) => {
    const name = el.tags?.name;
    if (!name) return false;
    const key = name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }).map((el: any) => {
    const tags = el.tags ?? {};
    const amenity = tags.amenity || tags.craft || "";
    const type = OSM_TYPE_MAP[amenity] ?? "venue";
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
      live_music_tagged: !!tags.live_music,
      already_in_pipeline: existingNames.has(tags.name.toLowerCase().trim()),
    };
  }).slice(0, 80);
}
