// Time zones an account can choose, and the shared rules for which zone a gig
// uses. Gig times are the venue's local time (where the gig happens).

export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

export const TIME_ZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles, Portland, Seattle)" },
  { value: "America/Denver", label: "Mountain (Denver, Salt Lake City)" },
  { value: "America/Phoenix", label: "Arizona (no daylight saving)" },
  { value: "America/Chicago", label: "Central (Chicago, Nashville, Austin)" },
  { value: "America/New_York", label: "Eastern (New York, Atlanta, Miami)" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "America/Toronto", label: "Toronto" },
  { value: "America/Vancouver", label: "Vancouver" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Central Europe (Paris, Berlin)" },
  { value: "Australia/Sydney", label: "Sydney" },
];

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// The venue's own zone wins; otherwise the artist's; otherwise Pacific.
export function gigTimeZone(venueZone: string | null | undefined, artistZone: string | null | undefined): string {
  if (isValidTimeZone(venueZone)) return venueZone;
  if (isValidTimeZone(artistZone)) return artistZone;
  return DEFAULT_TIME_ZONE;
}
