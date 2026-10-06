// lib/messages/send.ts
import { SupabaseClient } from "@supabase/supabase-js";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MESSAGE_BUCKET,
  blockedSendError,
  sniffAttachmentType,
  validateMessageInput,
} from "@/lib/messages/rules";
import { ConversationRow, Participant } from "@/lib/messages/access";
import { notifyNewMessage } from "@/lib/messages/notify";

export type AttachmentInput = { path: string; name: string; type: string; size: number };

type SendResult = { ok: true; messageId: string } | { ok: false; status: number; error: string };

// Shared by "venue starts a conversation with a first message" and
// "send a message in an existing conversation", so the block check, text
// and attachment validation, and notifications can't drift apart.
export async function sendMessage(
  service: SupabaseClient,
  args: {
    conversation: ConversationRow;
    participant: Participant;
    body: unknown;
    attachment?: AttachmentInput | null;
  }
): Promise<SendResult> {
  const { conversation, participant, attachment } = args;

  const blocked = blockedSendError(conversation.blocked_by, participant.role);
  if (blocked) return { ok: false, status: 403, error: blocked };

  const text = validateMessageInput(args.body, !!attachment);
  if (!text.ok) return { ok: false, status: 400, error: text.error };

  let verified: { path: string; name: string; type: string; size: number } | null = null;
  if (attachment) {
    // The path must be one this conversation's own upload route issued.
    if (typeof attachment.path !== "string" || !attachment.path.startsWith(`${conversation.id}/`) || attachment.path.includes("..")) {
      return { ok: false, status: 400, error: "That attachment isn't valid." };
    }
    const { data: blob, error: dlError } = await service.storage.from(MESSAGE_BUCKET).download(attachment.path);
    if (dlError || !blob) return { ok: false, status: 400, error: "We couldn't find that upload. Try attaching it again." };

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const realType = sniffAttachmentType(bytes);
    const tooBig = bytes.length > MAX_ATTACHMENT_BYTES;
    if (!realType || !(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(realType) || tooBig) {
      await service.storage.from(MESSAGE_BUCKET).remove([attachment.path]);
      return { ok: false, status: 400, error: "Only images (JPEG, PNG, WebP, GIF) and PDFs up to 10 MB can be attached." };
    }
    verified = {
      path: attachment.path,
      name: String(attachment.name ?? "file").slice(0, 120),
      type: realType,
      size: bytes.length,
    };
  }

  const { data: inserted, error } = await service
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_type: participant.role,
      sender_user_id: participant.userId,
      body: text.body,
      attachment_path: verified?.path ?? null,
      attachment_name: verified?.name ?? null,
      attachment_type: verified?.type ?? null,
      attachment_size: verified?.size ?? null,
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, status: 500, error: error?.message ?? "Couldn't send that message." };

  await service
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);

  // Email only if this is the sender's first message the other side hasn't read.
  const { count } = await service
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id)
    .eq("sender_type", participant.role)
    .is("read_at", null)
    .neq("id", inserted.id as string);

  await notifyNewMessage(service, {
    conversation,
    senderRole: participant.role,
    preview: text.body ? (text.body.length > 100 ? text.body.slice(0, 100) + "…" : text.body) : "Sent an attachment",
    emailFirstUnread: (count ?? 0) === 0,
  });

  return { ok: true, messageId: inserted.id as string };
}
