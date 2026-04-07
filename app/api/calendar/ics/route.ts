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
    // Subscription use — no session cookie, use uid directly
    userId = uid;
  } else {
    // Browser use — read from session
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Use raw Supabase client (no cookies needed) to query venues
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, city, address, follow_up_date, gig_time, notes")
    .eq("user_id", userId)
    .eq("stage", "booked")
    .not("follow_up_date", "is", null);

  if (error) {
    return new NextResponse("Failed to load venues", { status: 500 });
  }

  const events = (venues ?? []).map((v) => {
    const startHour = v.gig_time ? parseInt(v.gig_time.split(":")[0]) : 19;
    const startMin  = v.gig_time ? parseInt(v.gig_time.split(":")[1]) : 0;
    const endHour   = startHour + 3; // default 3-hour set

    const dtStart = toICSDate(v.follow_up_date!, startHour, startMin);
    const dtEnd   = toICSDate(v.follow_up_date!, endHour,   startMin);
    const summary  = escapeICS(`Gig at ${v.name}`);
    const location = escapeICS(v.address ?? v.city ?? v.name);
    const description = v.notes
      ? escapeICS(v.notes)
      : escapeICS(`Booked gig at ${v.name}`);
    const eventUid = `gigflow-${v.id}@gigflow.app`;
    const now = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z/, "Z");

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
