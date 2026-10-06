// lib/messages/unread.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { Participant } from "@/lib/messages/access";

// Messages sent by the other side that this person hasn't opened yet.
export async function countUnreadMessages(
  service: SupabaseClient,
  participant: Participant
): Promise<number> {
  const column = participant.role === "venue" ? "venue_profile_id" : "artist_user_id";
  const value = participant.role === "venue" ? participant.venueProfileId : participant.userId;

  const { data: convs } = await service.from("conversations").select("id").eq(column, value);
  const ids = (convs ?? []).map((c) => c.id as string);
  if (ids.length === 0) return 0;

  const { count } = await service
    .from("messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", ids)
    .neq("sender_type", participant.role)
    .is("read_at", null);
  return count ?? 0;
}
