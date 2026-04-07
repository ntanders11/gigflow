import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toICSDate(dateStr: string, hour: number) {
  // dateStr is YYYY-MM-DD, returns YYYYMMDDTHHMMSS local (no timezone — floating)
  const [y, m, d] = dateStr.split("-");
  return `${y}${m}${d}T${pad(hour)}0000`;
}

function escapeICS(str: string) {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function GET(req: NextRequest) {
  // Allow either an authenticated session or a ?uid= token (for calendar subscriptions)
  const uid = req.nextUrl.searchParams.get("uid");

  let userId: string | null = null;

  if (uid) {
    // Treat the uid param as the user_id directly (it's a hard-to-guess UUID)
    userId = uid;
  } else {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Use service client so this works even without a session cookie (subscription use)
  const { createServiceClient } = await import("@/lib/supabase/server");
  const supabase = await createServiceClient();

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, city, follow_up_date, notes")
    .eq("user_id", userId)
    .eq("stage", "booked")
    .not("follow_up_date", "is", null);

  const events = (venues ?? []).map((v) => {
    const dtStart = toICSDate(v.follow_up_date!, 19); // 7 PM
    const dtEnd = toICSDate(v.follow_up_date!, 22);   // 10 PM
    const summary = escapeICS(`Gig at ${v.name}`);
    const location = escapeICS(v.city ?? v.name);
    const description = v.notes ? escapeICS(v.notes) : escapeICS(`Booked gig at ${v.name}`);
    const uid = `gigflow-${v.id}@gigflow.app`;
    const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z/, "Z");

    return [
      "BEGIN:VEVENT",
      `UID:${uid}`,
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
      "Cache-Control": "no-cache",
    },
  });
}
