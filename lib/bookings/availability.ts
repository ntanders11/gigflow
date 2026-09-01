import { SupabaseClient } from "@supabase/supabase-js";

// Every individual date (YYYY-MM-DD) an artist is unavailable on:
// each upcoming confirmed gig's date, plus every day inside each
// blackout range, expanded individually. Used by the public
// availability endpoint to build the full "can't pick this date" set
// for a booking request's date picker — a list, not a single check,
// so it can be large; that's fine, callers just need a Set/array of
// strings, not a bounded response.
export async function getUnavailableDates(
  service: SupabaseClient,
  artistUserId: string
): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: gigRows } = await service
    .from("gigs")
    .select("date")
    .eq("user_id", artistUserId)
    .eq("status", "upcoming")
    .gte("date", today);

  const { data: blackoutRows } = await service
    .from("artist_blackout_dates")
    .select("start_date, end_date")
    .eq("user_id", artistUserId)
    .gte("end_date", today);

  const dates = new Set<string>((gigRows ?? []).map((r) => r.date as string));

  for (const row of blackoutRows ?? []) {
    // Iterate in UTC to avoid a local-timezone DST edge accidentally
    // skipping or repeating a day when adding 24 hours.
    let cursor = new Date(`${row.start_date}T00:00:00Z`);
    const rawEnd = new Date(`${row.end_date}T00:00:00Z`);
    // Clamp to 730 days as defense-in-depth against a pathological row
    // (e.g. a mistyped year) blowing up this loop and the response —
    // POST /api/blackout-dates also validates this at write time, but
    // this endpoint is public/unauthenticated and shouldn't rely solely
    // on that.
    const maxEnd = new Date(cursor.getTime() + 730 * 24 * 60 * 60 * 1000);
    const end = rawEnd < maxEnd ? rawEnd : maxEnd;
    while (cursor <= end) {
      dates.add(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  return Array.from(dates);
}

// A single-date check via two targeted point queries, used by the new
// server-side booking-request enforcement (POST
// /api/venue/booking-requests). Deliberately NOT implemented by calling
// getUnavailableDates and checking membership — that would mean
// generating a potentially large list just to check one date.
export async function isDateUnavailable(
  service: SupabaseClient,
  artistUserId: string,
  date: string
): Promise<boolean> {
  const { data: gigRows, error: gigError } = await service
    .from("gigs")
    .select("id")
    .eq("user_id", artistUserId)
    .eq("status", "upcoming")
    .eq("date", date)
    .limit(1);
  if (gigError) {
    console.error("isDateUnavailable: gig lookup failed, failing closed", gigError);
    return true;
  }
  if (gigRows && gigRows.length > 0) return true;

  const { data: blackoutRows, error: blackoutError } = await service
    .from("artist_blackout_dates")
    .select("id")
    .eq("user_id", artistUserId)
    .lte("start_date", date)
    .gte("end_date", date)
    .limit(1);
  if (blackoutError) {
    console.error("isDateUnavailable: blackout lookup failed, failing closed", blackoutError);
    return true;
  }
  return !!(blackoutRows && blackoutRows.length > 0);
}
