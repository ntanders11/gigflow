import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Map Google place types → our simplified type labels
const GOOGLE_TYPE_MAP: Record<string, string> = {
  bar: "bar",
  pub: "bar",
  night_club: "club",
  winery: "winery",
  wine_bar: "winery",
  brewery: "brewery",
  concert_hall: "venue",
  event_venue: "venue",
  performing_arts_theater: "venue",
  music_store: "venue",
  restaurant: "restaurant",
  hotel: "hotel",
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

// Geocode a city/zip string using Google Geocoding API (most reliable).
// Falls back to Nominatim restricted to the US if no Google key.
async function geocodeCity(
  city: string,
  googleKey: string | undefined
): Promise<{ lat: number; lon: number } | null> {
  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&region=us&key=${googleKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = await res.json();
        const loc = data.results?.[0]?.geometry?.location;
        if (loc) return { lat: loc.lat, lon: loc.lng };
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
  const radiusMeters = Math.min(miles * 1609, 50000); // Google Places max 50 km

  const googleKey = process.env.GOOGLE_PLACES_API_KEY;

  // Support legacy lat/lon params so old clients don't break,
  // but prefer the new city-based approach (geocoding server-side).
  let lat: number, lon: number;
  const latParam = parseFloat(searchParams.get("lat") ?? "");
  const lonParam = parseFloat(searchParams.get("lon") ?? "");

  if (!isNaN(latParam) && !isNaN(lonParam)) {
    lat = latParam;
    lon = lonParam;
  } else if (cityParam) {
    const coords = await geocodeCity(cityParam, googleKey);
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

  // ── 1. Try Google Places ───────────────────────────────────────────────────
  if (googleKey) {
    try {
      const results = await searchWithGoogle(lat, lon, radiusMeters, googleKey, existingNames);
      if (results.length > 0) {
        return NextResponse.json({ results });
      }
    } catch (err) {
      console.error("Google Places search failed:", err);
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

// ── Google Places Nearby Search ──────────────────────────────────────────────
async function searchWithGoogle(
  lat: number,
  lon: number,
  radiusMeters: number,
  apiKey: string,
  existingNames: Set<string>,
): Promise<DiscoverResult[]> {
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.types",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.rating",
    "places.userRatingCount",
  ].join(",");

  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": fieldMask,
  };

  const locationRestriction = {
    circle: {
      center: { latitude: lat, longitude: lon },
      radius: radiusMeters,
    },
  };

  // Two passes: music/nightlife first, then breweries & wineries
  const passes = [
    ["bar", "night_club", "concert_hall", "event_venue", "performing_arts_theater"],
    ["winery", "brewery"],
  ];

  const seen = new Set<string>();
  const results: DiscoverResult[] = [];

  for (const includedTypes of passes) {
    let res: Response;
    try {
      res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        headers,
        body: JSON.stringify({ locationRestriction, includedTypes, maxResultCount: 20 }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      continue;
    }
    if (!res.ok) continue;

    const data = await res.json();

    for (const place of data.places ?? []) {
      const name: string = place.displayName?.text ?? "";
      if (!name || seen.has(place.id)) continue;
      seen.add(place.id);

      // Pick the best matching type
      const placeTypes: string[] = place.types ?? [];
      let mappedType = "venue";
      for (const t of placeTypes) {
        if (GOOGLE_TYPE_MAP[t]) { mappedType = GOOGLE_TYPE_MAP[t]; break; }
      }

      // Extract city: Google address is "street, city, STATE zip, USA"
      const fullAddress: string = place.formattedAddress ?? "";
      const addrWithoutCountry = fullAddress.replace(/, USA$/, "");
      const addrParts = addrWithoutCountry.split(", ");
      // City is the second-to-last component (before "STATE zip")
      const city = addrParts.length >= 2 ? addrParts[addrParts.length - 2] : null;

      results.push({
        osm_id: place.id,
        name,
        type: mappedType,
        city,
        address: fullAddress || null,
        website: place.websiteUri || null,
        phone: place.nationalPhoneNumber || null,
        rating: typeof place.rating === "number" ? place.rating : null,
        review_count: place.userRatingCount ?? 0,
        live_music_tagged: false,
        already_in_pipeline: existingNames.has(name.toLowerCase().trim()),
      });
    }
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
