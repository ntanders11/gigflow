import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant, loadOwnConversation } from "@/lib/messages/access";

async function context(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const participant = await getParticipant(supabase, user.id);
  if (!participant) return { error: NextResponse.json({ error: "No account found" }, { status: 404 }) };
  const service = await createServiceClient();
  const conversation = await loadOwnConversation(service, participant, id);
  if (!conversation) return { error: NextResponse.json({ error: "Conversation not found" }, { status: 404 }) };
  return { service, participant, conversation };
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context((await params).id);
  if ("error" in ctx) return ctx.error;
  if (!ctx.conversation.blocked_by) {
    const { error } = await ctx.service
      .from("conversations")
      .update({ blocked_by: ctx.participant.role })
      .eq("id", ctx.conversation.id)
      .is("blocked_by", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// Only the person who blocked can unblock.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context((await params).id);
  if ("error" in ctx) return ctx.error;
  if (ctx.conversation.blocked_by !== ctx.participant.role) {
    return NextResponse.json({ error: "Only the person who blocked can unblock." }, { status: 403 });
  }
  const { error } = await ctx.service.from("conversations").update({ blocked_by: null }).eq("id", ctx.conversation.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
