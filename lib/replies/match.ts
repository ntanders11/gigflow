// Pure rules for deciding whether an inbox message is a real reply from a
// pipeline venue, and what to do with its stage.

export function normalizeEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

const AUTO_SUBJECT = /^(automatic reply|auto[- ]?reply|autoreply|out of office|undeliverable|delivery (status|has failed)|mail delivery|returned mail)/i;

export interface InboxMessage {
  id: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  headers?: { name: string; value: string }[];
}

// Auto-replies, bounces and out-of-office notices are not a venue answering.
export function isAutoReply(m: Pick<InboxMessage, "subject" | "headers" | "fromAddress">): boolean {
  if (AUTO_SUBJECT.test((m.subject ?? "").trim())) return true;
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(m.fromAddress)) return true;
  for (const h of m.headers ?? []) {
    const name = h.name.toLowerCase();
    const value = (h.value ?? "").toLowerCase();
    if (name === "auto-submitted" && value !== "no") return true;
    if (name === "x-auto-response-suppress" || name === "x-autoreply" || name === "x-autorespond") return true;
    if (name === "precedence" && /bulk|auto_reply|junk/.test(value)) return true;
  }
  return false;
}

// Contacted/Discovered venues that answer become Responded. Any other stage
// (Dormant, Responded, Negotiating, Booked) is left where it is — the artist is
// still told, but nothing is moved behind their back.
export function nextStageForReply(stage: string): "responded" | null {
  return stage === "contacted" || stage === "discovered" ? "responded" : null;
}
