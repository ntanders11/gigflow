import { SupabaseClient } from "@supabase/supabase-js";
import { refreshToken } from "@/lib/email/outlook";
import { createNotification } from "@/lib/notifications/create";
import { isAutoReply, nextStageForReply, normalizeEmail, InboxMessage } from "./match";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MAX_PAGES = 5; // 5 x 100 messages per scan — plenty for a day or two of inbox

interface Connection {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  reply_scan_cursor: string | null;
}

export interface ScanResult {
  checked: number;
  replies: number;
  error?: "permission" | "failed";
}

// Looks in an opted-in artist's Outlook inbox for mail received since the last
// scan, and matches the sender's address against venues in their pipeline. Only
// the sender, subject and received time are requested — never the message body.
export async function scanOutlookReplies(service: SupabaseClient, conn: Connection): Promise<ScanResult> {
  let token = conn.access_token;
  if (new Date(conn.expires_at).getTime() - Date.now() < REFRESH_BUFFER_MS) {
    try {
      token = await refreshToken(conn.id, conn.refresh_token);
    } catch (err) {
      console.error("reply scan: token refresh failed", err);
      return { checked: 0, replies: 0, error: "failed" };
    }
  }

  const since = conn.reply_scan_cursor ?? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const scanStartedAt = new Date().toISOString();

  const messages: InboxMessage[] = [];
  let url: string | null =
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?" +
    new URLSearchParams({
      $filter: `receivedDateTime ge ${since}`,
      $orderby: "receivedDateTime desc",
      $select: "id,from,subject,receivedDateTime,internetMessageHeaders",
      $top: "100",
    });

  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403) return { checked: messages.length, replies: 0, error: "permission" };
    if (!res.ok) {
      console.error("reply scan: graph error", res.status);
      return { checked: messages.length, replies: 0, error: "failed" };
    }
    const json = await res.json();
    for (const m of json.value ?? []) {
      messages.push({
        id: m.id,
        fromAddress: normalizeEmail(m.from?.emailAddress?.address),
        subject: m.subject ?? "",
        receivedAt: m.receivedDateTime,
        headers: m.internetMessageHeaders,
      });
    }
    url = json["@odata.nextLink"] ?? null;
  }

  const candidates = messages.filter((m) => m.fromAddress && !isAutoReply(m));
  let replies = 0;

  if (candidates.length > 0) {
    const { data: venues } = await service
      .from("venues")
      .select("id, name, stage, contact_email")
      .eq("user_id", conn.user_id)
      .not("contact_email", "is", null);

    const venueByEmail = new Map<string, { id: string; name: string; stage: string }>();
    for (const v of venues ?? []) {
      const e = normalizeEmail(v.contact_email as string);
      if (e) venueByEmail.set(e, { id: v.id as string, name: v.name as string, stage: v.stage as string });
    }

    // Already-handled messages (a re-scan of an overlapping window) are skipped.
    const ids = candidates.map((m) => m.id);
    const { data: seen } = await service
      .from("interactions")
      .select("resend_id")
      .eq("user_id", conn.user_id)
      .eq("type", "reply")
      .in("resend_id", ids);
    const seenIds = new Set((seen ?? []).map((s) => s.resend_id as string));

    // Oldest first, so a venue's stage change comes from its earliest reply.
    for (const m of [...candidates].reverse()) {
      const venue = venueByEmail.get(m.fromAddress);
      if (!venue || seenIds.has(m.id)) continue;
      try {
        await service.from("interactions").insert({
          venue_id: venue.id,
          user_id: conn.user_id,
          type: "reply",
          notes: `Reply received by email${m.subject ? `: ${m.subject}` : ""}`,
          occurred_at: m.receivedAt,
          resend_id: m.id,
          sent_via: "outlook",
        });
        const next = nextStageForReply(venue.stage);
        if (next) {
          await service.from("venues").update({ stage: next }).eq("id", venue.id);
          venue.stage = next; // a second reply in this scan shouldn't re-move it
        }
        await createNotification(service, {
          userId: conn.user_id,
          type: "reply_received",
          title: `${venue.name} replied`,
          body: m.subject || "Open the venue to see where things stand.",
          link: `/venues/${venue.id}`,
        });
        replies++;
      } catch (err) {
        console.error(`reply scan: failed to record reply for ${venue.id}`, err);
      }
    }
  }

  await service.from("email_connections").update({ reply_scan_cursor: scanStartedAt }).eq("id", conn.id);
  return { checked: messages.length, replies };
}

// Scans every artist who opted in. Used by the daily job.
export async function scanAllOptedInOutlook(service: SupabaseClient): Promise<number> {
  const { data: conns } = await service
    .from("email_connections")
    .select("id, user_id, access_token, refresh_token, expires_at, reply_scan_cursor")
    .eq("provider", "outlook")
    .eq("status", "active")
    .eq("reply_detection_enabled", true);
  let total = 0;
  for (const c of conns ?? []) {
    try {
      total += (await scanOutlookReplies(service, c as Connection)).replies;
    } catch (err) {
      console.error("reply scan failed for connection", c.id, err);
    }
  }
  return total;
}
