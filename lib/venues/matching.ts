// Shared name+city normalization used everywhere a venue's real-world
// identity needs to be matched against another record — the venue
// signup search, the linking sweep, and Discover Venues' StageReach
// badge. Keeping this in one place is what makes "same matching logic"
// actually true across all three call sites, not just true in the docs.

// A null city (venue hasn't entered one) is treated the same as an empty
// string — this matters because a venue that signs up without a city
// must still match and link correctly, not silently fail to match.
export function normalizeMatchKey(name: string, city: string | null): string {
  return `${name.trim().toLowerCase()}|${(city ?? "").trim().toLowerCase()}`;
}

// Escapes ILIKE special characters (%, _, \) in user-supplied search text
// before it's interpolated into a LIKE/ILIKE pattern. Without this, a
// caller-controlled "%" or "_" changes the meaning of the pattern itself
// (e.g. name=% would match every row), not just the literal text searched for.
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface MatchableVenue {
  name: string;
  city: string | null;
  address: string | null;
  type: string | null;
}

// Collapses duplicate entries that share a normalized name+city down to
// one, preferring whichever has the most of {address, type} filled in.
// Used when several different artists each have their own copy of the
// same real venue in their private pipelines — the venue signing up
// should see one match candidate, not five near-duplicates.
export function dedupeMatchableVenues<T extends MatchableVenue>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = normalizeMatchKey(row.name, row.city);
    const existing = byKey.get(key);
    if (!existing || completeness(row) > completeness(existing)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

function completeness(row: MatchableVenue): number {
  return [row.address, row.type].filter(Boolean).length;
}
