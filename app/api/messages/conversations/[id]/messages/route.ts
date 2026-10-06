import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant, loadOwnConversation } from "@/lib/messages/access";
import { sendMessage } from "@/lib/messages/send";

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
  const result = await sendMessage(service, {
    conversation,
    participant,
    body: body.body,
    attachment: body.attachment ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ id: result.messageId });
}
