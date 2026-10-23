import { SupabaseClient } from "@supabase/supabase-js";
import { createNotification } from "@/lib/notifications/create";
import { gigTimeZone } from "@/lib/time-zones";
import { localDateAndHour, REMIND_FROM_HOUR } from "@/lib/gigs/reminder-timing";

// Turns "remind me on <date>" into one bell notification + phone alert on that
// day (in the artist's own time zone, from the local morning). remind_notified_at
// stops it ever repeating. A Dormant venue is moved back to Contacted.
export async function sendDueVenueReminders(service: SupabaseClient, now: Date = new Date()): Promise<number> {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: due } = await service
    .from("venues")
    .select("id, user_id, name, stage, remind_on, remind_note")
    .not("remind_on", "is", null)
    .lte("remind_on", tomorrow)
    .is("remind_notified_at", null);
  if (!due || due.length === 0) return 0;

  const userIds = [...new Set(due.map((v) => v.user_id as string))];
  const { data: aps } = await service.from("artist_profiles").select("user_id, time_zone").in("user_id", userIds);
  const zoneByUser = new Map((aps ?? []).map((a) => [a.user_id as string, a.time_zone as string | null]));

  let sent = 0;
  for (const v of due) {
    const tz = gigTimeZone(null, zoneByUser.get(v.user_id as string));
    const local = localDateAndHour(now, tz);
    if ((v.remind_on as string) > local.date || local.hour < REMIND_FROM_HOUR) continue;
    try {
      await createNotification(service, {
        userId: v.user_id as string,
        type: "venue_reminder",
        title: `Time to follow up with ${v.name as string}`,
        body: (v.remind_note as string | null) || "You set a reminder to check back in.",
        link: `/venues/${v.id as string}`,
      });
      // When the reminder comes up, a Dormant venue goes back into the pipeline as
      // Contacted (it has been reached before). Other stages are left alone.
      await service
        .from("venues")
        .update({
          remind_notified_at: now.toISOString(),
          ...(v.stage === "dormant" ? { stage: "contacted" } : {}),
        })
        .eq("id", v.id);
      sent++;
    } catch (err) {
      console.error(`venue reminder failed for ${v.id}`, err);
    }
  }
  return sent;
}
