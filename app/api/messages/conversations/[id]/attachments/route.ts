import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant, loadOwnConversation } from "@/lib/messages/access";
import { MESSAGE_BUCKET, blockedSendError, sanitizeFileName, validateAttachmentDeclaration } from "@/lib/messages/rules";

// Step 1 of attaching a file: validate what the browser says it's about
// to upload and hand back a one-time signed upload URL token. Files go
// straight from the browser to storage (Vercel limits request bodies to
// ~4.5 MB, so a 10 MB file can't pass through this route). The real file
// type and size are checked again, from the stored file itself, when the
// message is sent (lib/messages/send.ts).
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

  const blocked = blockedSendError(conversation.blocked_by, participant.role);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const check = validateAttachmentDeclaration(String(body.type ?? ""), Number(body.size));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const path = `${conversation.id}/${randomUUID()}-${sanitizeFileName(String(body.name ?? "file"))}`;
  const { data, error } = await service.storage.from(MESSAGE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Couldn't prepare that upload. Try again." }, { status: 500 });

  return NextResponse.json({ path: data.path ?? path, token: data.token });
}
