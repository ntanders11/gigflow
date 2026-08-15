// Geocode a city/zip string. Google first (most accurate, requires
// billing), then Geoapify (free, no billing), then Nominatim (free,
// US-restricted) as a last resort.
export async function geocodeCity(
  city: string,
  googleKey: string | undefined,
  geoapifyKey: string | undefined
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
    } catch { /* fall through */ }
  }

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
