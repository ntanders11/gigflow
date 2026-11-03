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
}

export function buildPipelineIndex<T extends PipelineRow>(rows: T[]): PipelineIndex<T> {
  const names = new Map<string, T>();
  const phones = new Map<string, T>();
  for (const r of rows) {
    const n = looseNameKey(r.name);
    if (n.length >= 4 && !names.has(n)) names.set(n, r);
    const p = phoneKey(r.contact_phone);
    if (p && !phones.has(p)) phones.set(p, r);
  }
  return { names, phones };
}

// The pipeline venue this Discover result really is, if any.
export function findPipelineMatch<T extends PipelineRow>(
  index: PipelineIndex<T>,
  name: string,
  phone: string | null | undefined
): T | null {
  const n = looseNameKey(name);
  if (n.length >= 4) {
    const hit = index.names.get(n);
    if (hit) return hit;
  }
  const p = phoneKey(phone);
  return (p && index.phones.get(p)) || null;
}

// Venue fields Discover may fill in, and that count as a manual edit when the
// artist changes them.
export const DISCOVER_FILLABLE_FIELDS = ["website", "contact_phone", "address", "city", "type"] as const;

export function isInPipeline(index: PipelineIndex, name: string, phone: string | null | undefined): boolean {
  return findPipelineMatch(index, name, phone) !== null;
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
