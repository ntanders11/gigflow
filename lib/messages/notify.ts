// lib/messages/notify.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { createNotification } from "@/lib/notifications/create";
import { sendNewMessageEmail } from "@/lib/email/message-notifications";
import { ConversationRow } from "@/lib/messages/access";

// Always creates the in-app notification (+ push). Only emails when this
// is the first unread message in the thread. Never throws.
export async function notifyNewMessage(
  service: SupabaseClient,
  params: {
    conversation: ConversationRow;
    senderRole: "artist" | "venue";
    preview: string;
    emailFirstUnread: boolean;
  }
): Promise<void> {
  try {
    const { conversation, senderRole, preview, emailFirstUnread } = params;
    let recipientUserId: string | null = null;
    let senderName = "Someone";
    let link = "";

    if (senderRole === "venue") {
      recipientUserId = conversation.artist_user_id;
      link = `/messages?c=${conversation.id}`;
      const { data } = await service.from("venue_profiles").select("venue_name").eq("id", conversation.venue_profile_id).maybeSingle();
      senderName = (data?.venue_name as string | null) ?? "A venue";
    } else {
      link = `/venue/messages?c=${conversation.id}`;
      const { data: venue } = await service.from("venue_profiles").select("user_id").eq("id", conversation.venue_profile_id).maybeSingle();
      recipientUserId = (venue?.user_id as string | null) ?? null;
      const { data: artist } = await service.from("artist_profiles").select("display_name").eq("user_id", conversation.artist_user_id).maybeSingle();
      senderName = (artist?.display_name as string | null) ?? "An artist";
    }
    if (!recipientUserId) return;

    await createNotification(service, {
      userId: recipientUserId,
      type: "message_received",
      title: `New message from ${senderName}`,
      body: preview,
      link,
    });

    if (emailFirstUnread) await sendNewMessageEmail(service, recipientUserId, senderName, link);
  } catch (err) {
    console.error("notifyNewMessage failed", err);
  }
}
