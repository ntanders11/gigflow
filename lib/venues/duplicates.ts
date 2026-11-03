// Spots a Discover result that is really a venue the artist already has, even
// when the spelling differs ("Dillon's" vs "Dillons Bar & Grill") or the name
// is written differently by each search source. Matches on a loose name key or
// on the phone number — either is enough.
import { looseNameKey } from "./foursquare";

// Last 10 digits, or null when there aren't enough digits to trust.
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

// Street part of an address ("123 N Main St, Newberg, OR" -> "123 n main st"),
// with common street words spelled out the same way, or null when there's no
// house number to trust (a bare city or "Highway 99W" isn't specific enough).
const STREET_WORDS: Record<string, string> = {
  street: "st", avenue: "ave", road: "rd", highway: "hwy", boulevard: "blvd", drive: "dr", lane: "ln",
  north: "n", south: "s", east: "e", west: "w", suite: "ste",
};
export function addressKey(address: string | null | undefined): string | null {
  const street = (address ?? "").split(",")[0].toLowerCase().replace(/[.#]/g, " ").trim();
  if (!/^\d+\s/.test(street)) return null;
  return street
    .split(/\s+/)
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");
}

// Words that say what kind of place it is, not which place — ignored when
// asking whether two names share a distinctive word.
const GENERIC_NAME_WORDS = new Set([
  "the", "and", "bar", "grill", "pub", "restaurant", "cafe", "tavern", "lounge", "wine", "winery", "wines",
  "vineyard", "vineyards", "cellars", "cellar", "tasting", "room", "estate", "brewing", "brewery", "company", "co",
  "family", "bistro", "kitchen", "house", "club", "saloon", "taproom",
]);
function nameWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/['’]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w))
  );
}
export function sharesNameWord(a: string, b: string): boolean {
  const wa = nameWords(a);
  for (const w of nameWords(b)) if (wa.has(w)) return true;
  return false;
}

// Same street address AND a shared distinctive name word: the same business
// listed under two names ("Fox Farm Wine Bar" / "Fox Farm Vineyards Tasting
// Room"). The name check keeps different businesses in one building apart.
export function isSameBusinessByAddress(
  a: { name: string; address?: string | null },
  b: { name: string; address?: string | null }
): boolean {
  const ka = addressKey(a.address);
  return !!ka && ka === addressKey(b.address) && sharesNameWord(a.name, b.name);
}

export interface PipelineRow {
  id?: string;
  name: string;
  contact_phone?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  type?: string | null;
  manual_edit_fields?: string[] | null;
}

export interface PipelineIndex<T extends PipelineRow = PipelineRow> {
  names: Map<string, T>;
  phones: Map<string, T>;
  addresses: Map<string, T[]>;
}

export function buildPipelineIndex<T extends PipelineRow>(rows: T[]): PipelineIndex<T> {
  const names = new Map<string, T>();
  const phones = new Map<string, T>();
  const addresses = new Map<string, T[]>();
  for (const r of rows) {
    const a = addressKey(r.address);
    if (a) addresses.set(a, [...(addresses.get(a) ?? []), r]);
    const n = looseNameKey(r.name);
    if (n.length >= 4 && !names.has(n)) names.set(n, r);
    const p = phoneKey(r.contact_phone);
    if (p && !phones.has(p)) phones.set(p, r);
  }
  return { names, phones, addresses };
}

// The pipeline venue this Discover result really is, if any.
export function findPipelineMatch<T extends PipelineRow>(
  index: PipelineIndex<T>,
  name: string,
  phone: string | null | undefined,
  address?: string | null
): T | null {
  const n = looseNameKey(name);
  if (n.length >= 4) {
    const hit = index.names.get(n);
    if (hit) return hit;
  }
  const p = phoneKey(phone);
  const byPhone = p ? index.phones.get(p) : undefined;
  if (byPhone) return byPhone;
  const a = addressKey(address);
  if (a) return (index.addresses.get(a) ?? []).find((row) => sharesNameWord(row.name, name)) ?? null;
  return null;
}

// Venue fields Discover may fill in, and that count as a manual edit when the
// artist changes them.
export const DISCOVER_FILLABLE_FIELDS = ["website", "contact_phone", "address", "city", "type"] as const;

export function isInPipeline(
  index: PipelineIndex,
  name: string,
  phone: string | null | undefined,
  address?: string | null
): boolean {
  return findPipelineMatch(index, name, phone, address) !== null;
}

// Details Discover found that the saved venue is missing. Only blanks are
// filled — anything the artist already entered is never overwritten, and a
// field the artist has ever edited by hand (manual_edit_fields) is left alone
// even if they cleared it. Discover
// never has an email, so contact_email is never touched.
export function blanksToFill(
  saved: PipelineRow,
  found: { website: string | null; phone: string | null; address: string | null; city: string | null; type: string | null }
): Record<string, string> {
  const blank = (v: string | null | undefined) => !v || !v.trim();
  const edited = new Set(saved.manual_edit_fields ?? []);
  const patch: Record<string, string> = {};
  if (!edited.has("website") && blank(saved.website) && found.website) patch.website = found.website;
  if (!edited.has("contact_phone") && blank(saved.contact_phone) && found.phone) patch.contact_phone = found.phone;
  if (!edited.has("address") && blank(saved.address) && found.address) patch.address = found.address;
  if (!edited.has("city") && blank(saved.city) && found.city) patch.city = found.city;
  if (!edited.has("type") && blank(saved.type) && found.type) patch.type = found.type;
  return patch;
}
