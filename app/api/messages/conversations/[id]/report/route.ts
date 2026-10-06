import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant, loadOwnConversation } from "@/lib/messages/access";

function buildRowLink(messageId: string): string | null {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const match = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!match) return null;
  const query = `select * from messages where id = '${messageId}';`;
  return `https://supabase.com/dashboard/project/${match[1]}/sql/new?content=${encodeURIComponent(query)}`;
}

async function notifyTaylorOfReport(params: {
  messageId: string; conversationId: string; reporterUserId: string;
  body: string; attachmentName: string | null; reason: string | null;
}): Promise<void> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail) {
    console.error("message report: Resend not configured, skipping notification email");
    return;
  }
  const rowLink = buildRowLink(params.messageId);
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `StageReach <${fromEmail}>`,
    to: fromEmail,
    subject: "A message was reported on StageReach",
    text: [
      `Message ${params.messageId} (conversation ${params.conversationId}) was reported by user ${params.reporterUserId}.`,
      `Reason: ${params.reason ?? "(none given)"}`,
      "",
      `Message text: ${params.body || "(none)"}`,
      `Attachment: ${params.attachmentName ?? "(none)"}`,
      "",
      rowLink ?? "Look this row up directly in Supabase (messages table).",
    ].join("\n"),
  });
  if (error) console.error("message report: failed to send notification email", error);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant) return NextResponse.json({ error: "No account found" }, { status: 404 });

  const service = await createServiceClient();
  const conversation = await loadOwnConversation(service, participant, id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const messageId = typeof body.message_id === "string" ? body.message_id : "";
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 2000) : null;

  const { data: message } = await service
    .from("messages")
    .select("id, sender_type, body, attachment_name")
    .eq("id", messageId)
    .eq("conversation_id", conversation.id)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (message.sender_type === participant.role) {
    return NextResponse.json({ error: "You can only report messages from the other person." }, { status: 400 });
  }

  const { error: insertError } = await service
    .from("message_reports")
    .insert({ message_id: message.id, reporter_user_id: user.id, reason });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  try {
    await notifyTaylorOfReport({
      messageId: message.id as string,
      conversationId: conversation.id,
      reporterUserId: user.id,
      body: message.body as string,
      attachmentName: message.attachment_name as string | null,
      reason,
    });
  } catch (err) {
    console.error("message report: failed to send notification email", err);
  }
  return NextResponse.json({ success: true });
}
