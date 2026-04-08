import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

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

export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get("uid");

  let userId: string | null = null;

  if (uid) {
    userId = uid;
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Pull from gigs table, joining venue for name/city/address
  const { data: gigs, error } = await supabase
    .from("gigs")
    .select("id, date, start_time, end_time, notes, status, venues(id, name, city, address)")
    .eq("user_id", userId)
    .neq("status", "cancelled");

  if (error) {
    return new NextResponse("Failed to load gigs", { status: 500 });
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
      `DTSTART;TZID=America/Los_Angeles:${dtStart}`,
      `DTEND;TZID=America/Los_Angeles:${dtEnd}`,
      `SUMMARY:${summary}`,
      `LOCATION:${location}`,
      `DESCRIPTION:${description}`,
      "END:VEVENT",
    ].join("\r\n");
  });

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GigFlow//GigFlow//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:GigFlow Gigs",
    "X-WR-TIMEZONE:America/Los_Angeles",
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
