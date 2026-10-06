import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant } from "@/lib/messages/access";
import { countUnreadMessages } from "@/lib/messages/unread";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant) return NextResponse.json({ count: 0 });

  const service = await createServiceClient();
  return NextResponse.json({ count: await countUnreadMessages(service, participant) });
}
