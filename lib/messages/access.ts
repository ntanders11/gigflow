// lib/messages/access.ts
import { SupabaseClient } from "@supabase/supabase-js";

export type Participant =
  | { role: "venue"; userId: string; venueProfileId: string }
  | { role: "artist"; userId: string };

export type ConversationRow = {
  id: string;
  venue_profile_id: string;
  artist_user_id: string;
  blocked_by: "artist" | "venue" | null;
  last_message_at: string;
  created_at: string;
};

// Works out which kind of account is calling. A venue must have finished
// signup (venue_name set); an artist must have finished onboarding
// (display_name set). Pass the RLS-scoped client — both tables let a user
// read their own row.
export async function getParticipant(
  supabase: SupabaseClient,
  userId: string
): Promise<Participant | null> {
  const { data: venue } = await supabase
    .from("venue_profiles")
    .select("id, venue_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (venue) {
    return venue.venue_name
      ? { role: "venue", userId, venueProfileId: venue.id as string }
      : null;
  }
  const { data: artist } = await supabase
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  return artist?.display_name ? { role: "artist", userId } : null;
}

// Returns the conversation only if the caller is one of its two people.
// A non-member gets null (callers answer 404, so nobody can probe whether
// a conversation id exists).
export async function loadOwnConversation(
  service: SupabaseClient,
  participant: Participant,
  conversationId: string
): Promise<ConversationRow | null> {
  const { data } = await service
    .from("conversations")
    .select("id, venue_profile_id, artist_user_id, blocked_by, last_message_at, created_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) return null;
  const mine =
    participant.role === "venue"
      ? data.venue_profile_id === participant.venueProfileId
      : data.artist_user_id === participant.userId;
  return mine ? (data as ConversationRow) : null;
}
