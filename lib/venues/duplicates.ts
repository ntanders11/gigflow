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

export interface PipelineIndex {
  names: Set<string>;
  phones: Set<string>;
}

export function buildPipelineIndex(rows: { name: string; contact_phone?: string | null }[]): PipelineIndex {
  const names = new Set<string>();
  const phones = new Set<string>();
  for (const r of rows) {
    const n = looseNameKey(r.name);
    if (n.length >= 4) names.add(n);
    const p = phoneKey(r.contact_phone);
    if (p) phones.add(p);
  }
  return { names, phones };
}

export function isInPipeline(index: PipelineIndex, name: string, phone: string | null | undefined): boolean {
  const n = looseNameKey(name);
  if (n.length >= 4 && index.names.has(n)) return true;
  const p = phoneKey(phone);
  return !!p && index.phones.has(p);
}
