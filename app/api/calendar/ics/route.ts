import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { gigTimeZone } from "@/lib/time-zones";

function pad(n: string) {
  return n.padStart(2, "0");
}

function toICSDate(dateStr: string, hour: number, minute: number = 0) {
  const [y, m, d] = dateStr.split("-");
  return `${y}${pad(m)}${pad(d)}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}00`;
}

function escapeICS(str: string) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let userId: string | null = null;

  if (token !== null) {
    // Calendar apps fetch this with no login, so access is by the artist's
    // private calendar_token. It used to be the artist's account id (`uid`),
    // which is public in /profile/<id> — that style of link no longer works.
    if (!UUID_RE.test(token)) return new NextResponse("Not found", { status: 404 });
    const { data: owner } = await supabase
      .from("artist_profiles")
      .select("user_id")
      .eq("calendar_token", token)
      .maybeSingle();
    if (!owner) return new NextResponse("Not found", { status: 404 });
    userId = owner.user_id as string;
  } else {
    // No token: a logged-in artist downloading their own calendar.
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    userId = user?.id ?? null;
  }

  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Pull from gigs table, joining venue for name/city/address
  const { data: gigs, error } = await supabase
    .from("gigs")
    .select("id, date, start_time, end_time, notes, status, venues(id, name, city, address, venue_profile_id)")
    .eq("user_id", userId)
    .neq("status", "cancelled");

  if (error) {
    return new NextResponse("Failed to load gigs", { status: 500 });
  }

  // Gig times are the venue's local time: a linked StageReach venue's own zone,
  // else the artist's zone.
  const { data: artistRow } = await supabase
    .from("artist_profiles").select("time_zone").eq("user_id", userId).maybeSingle();
  const artistZone = (artistRow?.time_zone as string | null) ?? null;
  const venueProfileIds = [...new Set((gigs ?? []).map((g) => (g.venues as { venue_profile_id?: string } | null)?.venue_profile_id).filter(Boolean))] as string[];
  const zoneByVenueProfile = new Map<string, string>();
  if (venueProfileIds.length > 0) {
    const { data: vps } = await supabase.from("venue_profiles").select("id, time_zone").in("id", venueProfileIds);
    for (const v of vps ?? []) zoneByVenueProfile.set(v.id as string, v.time_zone as string);
  }

  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z/, "Z");

  const events = (gigs ?? []).map((g: any) => {
    const venue = g.venues ?? {};
    const startHour = g.start_time ? parseInt(g.start_time.split(":")[0]) : 19;
    const startMin  = g.start_time ? parseInt(g.start_time.split(":")[1]) : 0;
    const endHour   = g.end_time   ? parseInt(g.end_time.split(":")[0])   : startHour + 3;
    const endMin    = g.end_time   ? parseInt(g.end_time.split(":")[1])   : startMin;

    const tz = gigTimeZone(zoneByVenueProfile.get(venue.venue_profile_id) ?? null, artistZone);
    const dtStart  = toICSDate(g.date, startHour, startMin);
    const dtEnd    = toICSDate(g.date, endHour,   endMin);
    const summary  = escapeICS(`Gig at ${venue.name ?? "Venue"}`);
    const location = escapeICS(venue.address ?? venue.city ?? venue.name ?? "");
    const descParts = [
      g.notes,
      venue.name,
      venue.city,
    ].filter(Boolean);
    const description = escapeICS(descParts.join(" · "));

    // Unique UID per gig (not per venue) so each date is a separate calendar event
    const eventUid = `gigflow-gig-${g.id}@gigflow.app`;

    return [
      "BEGIN:VEVENT",
      `UID:${eventUid}`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=${tz}:${dtStart}`,
      `DTEND;TZID=${tz}:${dtEnd}`,
      `SUMMARY:${summary}`,
      `LOCATION:${location}`,
      `DESCRIPTION:${description}`,
      "END:VEVENT",
    ].join("\r\n");
  });

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StageReach//StageReach//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:StageReach Gigs",
    `X-WR-TIMEZONE:${gigTimeZone(null, artistZone)}`,
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="gigflow.ics"',
      "Cache-Control": "no-cache, no-store",
    },
  });
}
