import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  const city = req.nextUrl.searchParams.get("city");

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const query = [name, city].filter(Boolean).join(", ");

  // ── Google Places Text Search (preferred) ──────────────────────────────────
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  if (googleKey) {
    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": googleKey,
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.shortFormattedAddress",
        },
        body: JSON.stringify({ textQuery: query }),
      });

      if (res.ok) {
        const data = await res.json();
        const place = data?.places?.[0];
        if (place?.formattedAddress) {
          return NextResponse.json({ address: place.formattedAddress });
        }
      }
    } catch {
      // fall through to Nominatim
    }
  }

  // ── Nominatim fallback (OpenStreetMap) ─────────────────────────────────────
  const headers = {
    "User-Agent": "GigFlow/1.0 (taylorandersonmusic.com)",
    "Accept-Language": "en-US,en",
  };

  const queries = [
    [name, city, "USA"].filter(Boolean).join(", "),
    [name, "USA"].filter(Boolean).join(", "),
  ];

  let results: any[] = [];
  for (const q of queries) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=3&addressdetails=1`;
    const res = await fetch(url, { headers });
    if (!res.ok) continue;
    const data = await res.json();
    if (data && data.length > 0) { results = data; break; }
  }

  if (results.length === 0) {
    return NextResponse.json({ address: null, message: "Not found — please enter the address manually." });
  }

  const best = results[0];
  const a = best.address ?? {};
  const parts = [
    a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road ?? null,
    a.city ?? a.town ?? a.village ?? a.county ?? null,
    a.state ?? null,
    a.postcode ?? null,
  ].filter(Boolean);

  const address = parts.length > 0 ? parts.join(", ") : best.display_name;
  return NextResponse.json({ address });
}
