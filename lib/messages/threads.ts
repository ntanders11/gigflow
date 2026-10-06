// lib/messages/threads.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { MESSAGE_BUCKET } from "@/lib/messages/rules";
import { ConversationRow, Participant } from "@/lib/messages/access";
import { ConversationView, MessageView, ThreadView } from "@/types";

type Counterpart = { name: string; photo: string | null; href: string };

async function loadCounterparts(
  service: SupabaseClient,
  participant: Participant,
  rows: ConversationRow[]
): Promise<Map<string, Counterpart>> {
  const out = new Map<string, Counterpart>();
  if (rows.length === 0) return out;

  if (participant.role === "artist") {
    const ids = [...new Set(rows.map((r) => r.venue_profile_id))];
    const { data } = await service.from("venue_profiles").select("id, venue_name, photo_url").in("id", ids);
    const byId = new Map((data ?? []).map((v) => [v.id as string, v]));
    for (const r of rows) {
      const v = byId.get(r.venue_profile_id);
      out.set(r.id, {
        name: (v?.venue_name as string | null) ?? "A venue",
        photo: (v?.photo_url as string | null) ?? null,
        href: `/venues/profile/${r.venue_profile_id}`,
      });
    }
  } else {
    const ids = [...new Set(rows.map((r) => r.artist_user_id))];
    const { data } = await service.from("artist_profiles").select("user_id, display_name, photo_url").in("user_id", ids);
    const byId = new Map((data ?? []).map((a) => [a.user_id as string, a]));
    for (const r of rows) {
      const a = byId.get(r.artist_user_id);
      out.set(r.id, {
        name: (a?.display_name as string | null) ?? "An artist",
        photo: (a?.photo_url as string | null) ?? null,
        href: `/profile/${r.artist_user_id}`,
      });
    }
  }
  return out;
}

function previewOf(body: string, attachmentName: string | null): string {
  const text = body.trim();
  if (text) return text.length > 80 ? text.slice(0, 80) + "…" : text;
  return attachmentName ? `Attachment: ${attachmentName}` : "";
}

export async function buildConversationViews(
  service: SupabaseClient,
  participant: Participant,
  rows: ConversationRow[]
): Promise<ConversationView[]> {
  if (rows.length === 0) return [];
  const counterparts = await loadCounterparts(service, participant, rows);

  // One query for every conversation's recent messages; last message and
  // unread count are worked out in JS. Capped at 1,000 rows — plenty for
  // the beta; revisit with per-conversation queries if it ever isn't.
  const { data: msgs } = await service
    .from("messages")
    .select("conversation_id, sender_type, body, attachment_name, created_at, read_at")
    .in("conversation_id", rows.map((r) => r.id))
    .order("created_at", { ascending: false })
    .limit(1000);

  const last = new Map<string, { body: string; attachment_name: string | null }>();
  const unread = new Map<string, number>();
  for (const m of msgs ?? []) {
    const cid = m.conversation_id as string;
    if (!last.has(cid)) last.set(cid, { body: m.body as string, attachment_name: m.attachment_name as string | null });
    if (m.sender_type !== participant.role && !m.read_at) unread.set(cid, (unread.get(cid) ?? 0) + 1);
  }

  return rows.map((r): ConversationView => {
    const c = counterparts.get(r.id);
    const l = last.get(r.id);
    return {
      id: r.id,
      counterpart_name: c?.name ?? "Unknown",
      counterpart_photo_url: c?.photo ?? null,
      counterpart_href: c?.href ?? "#",
      last_message_preview: l ? previewOf(l.body, l.attachment_name) : "",
      last_message_at: r.last_message_at,
      unread_count: unread.get(r.id) ?? 0,
      blocked: !!r.blocked_by,
    };
  });
}

export async function buildThread(
  service: SupabaseClient,
  participant: Participant,
  conversation: ConversationRow
): Promise<ThreadView> {
  // Opening a thread marks the other side's messages as read.
  await service
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversation.id)
    .neq("sender_type", participant.role)
    .is("read_at", null);

  const { data: rows } = await service
    .from("messages")
    .select("id, sender_type, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(500);
  rows?.reverse();

  const paths = (rows ?? []).map((m) => m.attachment_path as string | null).filter((p): p is string => !!p);
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await service.storage.from(MESSAGE_BUCKET).createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  const messages: MessageView[] = (rows ?? []).map((m) => {
    const path = m.attachment_path as string | null;
    const url = path ? urlByPath.get(path) : undefined;
    return {
      id: m.id as string,
      mine: m.sender_type === participant.role,
      body: m.body as string,
      created_at: m.created_at as string,
      attachment:
        path && url
          ? { name: m.attachment_name as string, type: m.attachment_type as string, size: m.attachment_size as number, url }
          : null,
    };
  });

  const [view] = await buildConversationViews(service, participant, [conversation]);

  // The most relevant booking request between this pair, shown pinned at
  // the top of the thread. Looked up on read, not stored.
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: booking } = await service
    .from("booking_requests")
    .select("date, status")
    .eq("venue_profile_id", conversation.venue_profile_id)
    .eq("artist_user_id", conversation.artist_user_id)
    .in("status", ["pending", "accepted"])
    .gte("date", todayStr)
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    conversation: { ...view, unread_count: 0 },
    messages,
    blocked_by_me: conversation.blocked_by === participant.role,
    booking: booking ? { date: booking.date as string, status: booking.status as string } : null,
  };
}
