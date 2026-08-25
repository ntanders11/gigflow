import { SupabaseClient } from "@supabase/supabase-js";
import { NotificationType } from "@/types";

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
}
