// app/api/messages/conversations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ConversationRow, getParticipant } from "@/lib/messages/access";
import { buildConversationViews } from "@/lib/messages/threads";
import { sendMessage } from "@/lib/messages/send";

const COLUMNS = "id, venue_profile_id, artist_user_id, blocked_by, last_message_at, created_at";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant) return NextResponse.json({ error: "No account found" }, { status: 404 });

  const service = await createServiceClient();
  const { data: rows, error } = await service
    .from("conversations")
    .select(COLUMNS)
    .eq(participant.role === "venue" ? "venue_profile_id" : "artist_user_id",
        participant.role === "venue" ? participant.venueProfileId : participant.userId)
    .order("last_message_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const views = await buildConversationViews(service, participant, (rows ?? []) as ConversationRow[]);
  // Artists don't see a conversation until the venue has actually sent something.
  const conversations = participant.role === "artist" ? views.filter((v) => v.last_message_preview !== "") : views;
  return NextResponse.json({ conversations });
}

// Venues only. Artists can reply inside a conversation but never start one.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant || participant.role !== "venue") {
    return NextResponse.json({ error: "Only venues can start a conversation." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const artistUserId = body.artist_user_id;
  if (typeof artistUserId !== "string" || !artistUserId) {
    return NextResponse.json({ error: "artist_user_id is required" }, { status: 400 });
  }

  const service = await createServiceClient();
  const { data: artist } = await service
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", artistUserId)
    .maybeSingle();
  if (!artist?.display_name) return NextResponse.json({ error: "That artist could not be found." }, { status: 404 });

  let { data: conversation } = await service
    .from("conversations")
    .select(COLUMNS)
    .eq("venue_profile_id", participant.venueProfileId)
    .eq("artist_user_id", artistUserId)
    .maybeSingle();

  if (!conversation) {
    const { data: created, error } = await service
      .from("conversations")
      .insert({ venue_profile_id: participant.venueProfileId, artist_user_id: artistUserId })
      .select(COLUMNS)
      .single();
    if (error?.code === "23505") {
      // Two requests raced; use the one that won.
      const { data: existing } = await service
        .from("conversations").select(COLUMNS)
        .eq("venue_profile_id", participant.venueProfileId).eq("artist_user_id", artistUserId).single();
      conversation = existing;
    } else if (error || !created) {
      return NextResponse.json({ error: error?.message ?? "Couldn't start that conversation." }, { status: 500 });
    } else {
      conversation = created;
    }
  }

  const row = conversation as ConversationRow;
  const hasFirstMessage = typeof body.body === "string" && body.body.trim().length > 0;
  if (hasFirstMessage) {
    const result = await sendMessage(service, { conversation: row, participant, body: body.body });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ id: row.id });
}
