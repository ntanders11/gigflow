import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  const city = req.nextUrl.searchParams.get("city");

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const query = [name, city].filter(Boolean).join(", ");

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&addressdetails=1&countrycodes=us`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "GigFlow/1.0 (taylorandersonmusic.com)",
      "Accept-Language": "en-US,en",
    },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  const results = await res.json();

  if (!results || results.length === 0) {
    return NextResponse.json({ address: null, message: "No results found" });
  }

  // Build a clean address from the best result
  const best = results[0];
  const a = best.address ?? {};

  const parts = [
    a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road ?? null,
    a.city ?? a.town ?? a.village ?? a.county ?? null,
    a.state ?? null,
    a.postcode ?? null,
  ].filter(Boolean);

  const address = parts.length > 0 ? parts.join(", ") : best.display_name;

  return NextResponse.json({ address, all: results.slice(0, 3).map((r: { display_name: string }) => r.display_name) });
}
