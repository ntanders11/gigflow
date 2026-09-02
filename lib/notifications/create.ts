import { SupabaseClient } from "@supabase/supabase-js";
import { NotificationType } from "@/types";
import { sendPushToUser } from "@/lib/push/send";

const PUSHABLE_TYPES = new Set<NotificationType>([
  "booking_request_received",
  "booking_request_accepted",
  "booking_request_declined",
  "booking_cancelled_by_venue",
  "booking_cancelled_by_artist",
  "booking_rescheduled",
  // Time-sensitive by nature — the whole point is catching someone before
  // the gig, so this is worth a phone alert like the booking events above.
  "gig_reminder",
]);

// Never throws — a failed notification insert must never affect whether
// the email alongside it sends, or the action it's attached to. Uses the
// non-throwing { data, error } check (no .throwOnError(), no manual
// throw) so a bad insert genuinely cannot raise an exception; callers
// still wrap this in their own try/catch as defense in depth, matching
// how every other side-effect in this codebase is called.
export async function createNotification(
  service: SupabaseClient,
  params: { userId: string; type: NotificationType; title: string; body?: string; link: string }
): Promise<void> {
  const { error } = await service.from("notifications").insert({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link,
  });
  if (error) console.error("createNotification: insert failed", error);

  if (PUSHABLE_TYPES.has(params.type)) {
    try {
      await sendPushToUser(service, params.userId, {
        title: params.title,
        body: params.body,
        url: params.link,
      });
    } catch (err) {
      console.error("createNotification: push send failed", err);
    }
  }
}
