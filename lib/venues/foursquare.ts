// Foursquare Places as a third Discover Venues source, next to Google and
// Geoapify. It's good at small-town bars, wineries and tasting rooms that
// Google files differently, but it says nothing about live music and its
// phone/website data is patchy, so results are filtered hard: only drinking
// spots, and only ones with a phone number or website to pitch.

export type FoursquareVenue = {
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
  venue_profile_id: string | null;
  avg_rating: number | null;
  rating_count: number;
};

export interface FoursquareRawPlace {
  fsq_place_id?: string;
  name?: string;
  location?: { address?: string; locality?: string; formatted_address?: string };
  categories?: { name?: string }[];
  tel?: string;
  website?: string;
}

const DRINKING_SPOT =
  /\b(bar|pub|lounge|tavern|brewery|brewpub|winery|vineyard|wine|tasting|saloon|club|speakeasy|distillery|taproom|beer|cocktail|music|jazz|piano|karaoke)\b/i;
const NOT_A_VENUE = /\b(store|shop|retail|school|library|market)\b/i;

// Foursquare's "Bar" and "Dining and Drinking" category ids.
const BAR_CATEGORY = "4bf58dd8d48988d116941735";
const DINING_DRINKING_CATEGORY = "4d4b7105d754a06374d81259";

function simplifiedType(categoryNames: string[]): string {
  const text = categoryNames.join(" ");
  if (/wine|winery|vineyard|tasting/i.test(text)) return "winery";
  if (/brewer|beer|taproom/i.test(text)) return "brewery";
  if (/club/i.test(text)) return "club";
  return "bar";
}

// Returns null for anything that isn't a pitchable drinking spot.
export function mapFoursquarePlace(p: FoursquareRawPlace, existingNames: Set<string>): FoursquareVenue | null {
  const name = p.name?.trim();
  if (!name) return null;
  const categoryNames = (p.categories ?? []).map((c) => c.name ?? "").filter(Boolean);
  if (!categoryNames.some((c) => DRINKING_SPOT.test(c))) return null;
  if (categoryNames.some((c) => NOT_A_VENUE.test(c))) return null;
  const phone = p.tel?.trim() || null;
  const website = p.website?.trim() || null;
  if (!phone && !website) return null;

  return {
    osm_id: p.fsq_place_id ?? `fsq:${name}`,
    name,
    type: simplifiedType(categoryNames),
    city: p.location?.locality ?? null,
    address: p.location?.formatted_address ?? p.location?.address ?? null,
    website,
    phone,
    rating: null,
    review_count: 0,
    live_music_tagged: false,
    already_in_pipeline: existingNames.has(name.toLowerCase().trim()),
    venue_profile_id: null,
    avg_rating: null,
    rating_count: 0,
  };
}

// Loose name key so "McMenamin's Pub" and "McMenamins Roof Top Bar" style
// near-duplicates between sources collapse to one result.
export function looseNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.,]/g, "")
    .replace(/\b(the|and|bar|grill|pub|restaurant|cafe|tavern|lounge|co|company|llc|inc|of|at)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

export async function searchWithFoursquare(
  lat: number,
  lon: number,
  radiusMeters: number,
  apiKey: string,
  existingNames: Set<string>,
): Promise<FoursquareVenue[]> {
  const fetchPage = async (category: string): Promise<FoursquareRawPlace[]> => {
    const url = new URL("https://places-api.foursquare.com/places/search");
    url.searchParams.set("ll", `${lat},${lon}`);
    url.searchParams.set("radius", String(Math.min(radiusMeters, 100000)));
    url.searchParams.set("limit", "50");
    url.searchParams.set("fsq_category_ids", category);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, "X-Places-Api-Version": "2025-06-17", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Foursquare places error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()).results ?? []) as FoursquareRawPlace[];
  };

  const [bars, dining] = await Promise.all([fetchPage(BAR_CATEGORY), fetchPage(DINING_DRINKING_CATEGORY)]);
  const seen = new Set<string>();
  const results: FoursquareVenue[] = [];
  for (const raw of [...bars, ...dining]) {
    const id = raw.fsq_place_id ?? raw.name ?? "";
    if (seen.has(id)) continue;
    seen.add(id);
    const mapped = mapFoursquarePlace(raw, existingNames);
    if (mapped) results.push(mapped);
  }
  return results;
}
