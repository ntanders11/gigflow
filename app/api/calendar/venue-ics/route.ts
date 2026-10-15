import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeICS(str: string) {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toICSDate(dateStr: string, hour: number, minute: number) {
  const [y, m, d] = dateStr.split("-");
  return `${y}${m}${d}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}00`;
}

// Subscription feed of a venue's accepted bookings. Calendar apps fetch it
// with no login, so access is by the venue's private calendar_token (not its
// public profile id) — anyone holding the link can see these bookings.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  if (!UUID_RE.test(token)) return new NextResponse("Not found", { status: 404 });

  const service = await createServiceClient();

  const { data: venue } = await service
    .from("venue_profiles")
    .select("id, venue_name, address, city")
    .eq("calendar_token", token)
    .maybeSingle();
  if (!venue) return new NextResponse("Not found", { status: 404 });

  const { data: bookings, error } = await service
    .from("booking_requests")
    .select("id, date, start_time, end_time, artist_user_id")
    .eq("venue_profile_id", venue.id)
    .eq("status", "accepted");
  if (error) return new NextResponse("Failed to load bookings", { status: 500 });

  const artistIds = [...new Set((bookings ?? []).map((b) => b.artist_user_id as string))];
  const nameByUser = new Map<string, string>();
  if (artistIds.length > 0) {
    const { data: artists } = await service
      .from("artist_profiles")
      .select("user_id, display_name")
      .in("user_id", artistIds);
    for (const a of artists ?? []) nameByUser.set(a.user_id as string, (a.display_name as string) ?? "");
  }

  const venueName = (venue.venue_name as string) ?? "your venue";
  const location = escapeICS((venue.address as string) ?? (venue.city as string) ?? venueName);
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z/, "Z");

  const events = (bookings ?? []).map((b) => {
    const [sh, sm] = ((b.start_time as string | null) ?? "19:00").split(":").map(Number);
    let eh: number, em: number;
    if (b.end_time) {
      [eh, em] = (b.end_time as string).split(":").map(Number);
    } else {
      // No end time given: assume three hours, but never run past midnight.
      eh = Math.min(sh + 3, 23);
      em = sh + 3 > 23 ? 59 : sm;
    }
    const artist = nameByUser.get(b.artist_user_id as string) || "Artist";
    return [
      "BEGIN:VEVENT",
      `UID:stagereach-booking-${b.id}@stagereach.app`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=America/Los_Angeles:${toICSDate(b.date as string, sh, sm)}`,
      `DTEND;TZID=America/Los_Angeles:${toICSDate(b.date as string, eh, em)}`,
      `SUMMARY:${escapeICS(`${artist} at ${venueName}`)}`,
      `LOCATION:${location}`,
      "END:VEVENT",
    ].join("\r\n");
  });

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StageReach//StageReach//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:StageReach Bookings",
    "X-WR-TIMEZONE:America/Los_Angeles",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="stagereach-bookings.ics"',
      "Cache-Control": "no-cache, no-store",
    },
  });
}
