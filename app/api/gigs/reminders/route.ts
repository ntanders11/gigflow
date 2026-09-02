// app/api/gigs/reminders/route.ts
//
// Day-of gig reminders. Triggered by a daily Vercel cron (see vercel.json)
// each morning. For every upcoming gig happening today, notifies the
// artist always, and the venue too if it's a real linked StageReach
// account (venues.venue_profile_id set) — a private pipeline-only venue
// has no account to notify. gigs.reminder_sent_at (migration
// 027_gig_reminders.sql) stops a gig from ever being reminded twice, even
// if this route somehow fires more than once on the same day.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications/create";
import { CHECKLIST_ITEMS } from "@/lib/gigs/checklist";

function fmtTime(t: string | null): string | null {
  if (!t) return null;
  return new Date(`2000-01-01T${t}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export async function POST(request: NextRequest) {
  // Vercel injects Authorization: Bearer <CRON_SECRET> on cron invocations
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = await createServiceClient();
  const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  const { data: gigs, error: gigsError } = await service
    .from("gigs")
    .select("id, user_id, venue_id, date, start_time, end_time, checklist")
    .eq("status", "upcoming")
    .eq("date", todayStr)
    .is("reminder_sent_at", null);

  if (gigsError) return NextResponse.json({ error: gigsError.message }, { status: 500 });
  if (!gigs || gigs.length === 0) {
    return NextResponse.json({ reminded: 0, message: "No gigs today need a reminder" });
  }

  const venueIds = [...new Set(gigs.map((g) => g.venue_id as string))];
  const { data: venues } = await service
    .from("venues")
    .select("id, name, address, city, venue_profile_id")
    .in("id", venueIds);
  const venueById = new Map((venues ?? []).map((v) => [v.id as string, v]));

  const linkedProfileIds = [...new Set((venues ?? []).map((v) => v.venue_profile_id).filter(Boolean) as string[])];
  const { data: venueProfiles } = await service
    .from("venue_profiles")
    .select("id, user_id")
    .in("id", linkedProfileIds.length > 0 ? linkedProfileIds : [""]);
  const venueUserIdByProfileId = new Map((venueProfiles ?? []).map((p) => [p.id as string, p.user_id as string]));

  const artistUserIds = [...new Set(gigs.map((g) => g.user_id as string))];
  const { data: artistProfiles } = await service
    .from("artist_profiles")
    .select("user_id, display_name")
    .in("user_id", artistUserIds);
  const artistNameByUserId = new Map((artistProfiles ?? []).map((a) => [a.user_id as string, (a.display_name as string | null) ?? "An artist"]));

  let remindedCount = 0;

  for (const gig of gigs) {
    const venue = venueById.get(gig.venue_id as string);
    if (!venue) continue;

    const startLabel = fmtTime(gig.start_time as string | null);
    const endLabel = fmtTime(gig.end_time as string | null);
    const timeText = startLabel ? `${startLabel}${endLabel ? ` – ${endLabel}` : ""}` : "no time set";

    try {
      // Artist side — always, it's their gig.
      const checklist = (gig.checklist as string[] | null) ?? [];
      const openItems = CHECKLIST_ITEMS.length - checklist.length;
      const checklistNote = openItems > 0
        ? ` ${openItems} prep checklist item${openItems !== 1 ? "s" : ""} still open.`
        : " Prep checklist is all done.";

      await createNotification(service, {
        userId: gig.user_id as string,
        type: "gig_reminder",
        title: `Tonight: ${venue.name as string}`,
        body: `${timeText}${venue.address ? ` · ${venue.address}` : venue.city ? ` · ${venue.city}` : ""}.${checklistNote}`,
        link: `/venues/${venue.id}`,
      });

      // Venue side — only if it's a real, linked StageReach account.
      const venueProfileId = venue.venue_profile_id as string | null;
      const venueUserId = venueProfileId ? venueUserIdByProfileId.get(venueProfileId) : undefined;
      if (venueUserId) {
        const artistName = artistNameByUserId.get(gig.user_id as string) ?? "Your artist";
        await createNotification(service, {
          userId: venueUserId,
          type: "gig_reminder",
          title: `Tonight: ${artistName}`,
          body: `Set time ${timeText}.`,
          link: "/venue/bookings",
        });
      }

      await service.from("gigs").update({ reminder_sent_at: new Date().toISOString() }).eq("id", gig.id);
      remindedCount++;
    } catch (err) {
      console.error(`gig reminder: failed for gig ${gig.id}`, err);
    }
  }

  return NextResponse.json({ reminded: remindedCount, total: gigs.length });
}
