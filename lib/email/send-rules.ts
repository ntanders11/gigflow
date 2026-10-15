// lib/email/send-rules.ts
// Pure rules for which email connection an artist's pitch/follow-up may be
// sent through — no server or database imports, so they can be unit-tested and
// shared. The one hard rule: artist emails go out ONLY through the artist's
// own Gmail/Outlook. There is deliberately no "fall back to the shared
// StageReach (Resend) address" — that shared sender has a daily cap (about
// 100/day) that every artist would be sharing.

export interface ConnectionStatusInfo {
  status: "active" | "needs_reconnect";
  updated_at: string;
}

export type BlockedCode = "not_connected" | "needs_reconnect";

export const BLOCKED_MESSAGES: Record<BlockedCode | "send_failed", string> = {
  not_connected:
    "Connect your Gmail or Outlook before sending emails. Open your profile and tap \"Connect email\" — it takes about a minute.",
  needs_reconnect:
    "Your email connection needs to be reconnected before you can send. Open your profile and reconnect Gmail or Outlook.",
  send_failed:
    "Your Gmail or Outlook couldn't send this email. Please try again, or reconnect your email from your profile.",
};

// Among working (active) connections, the most recently updated one wins.
export function pickConnection<T extends ConnectionStatusInfo>(connections: T[]): T | null {
  if (connections.length === 0) return null;
  const active = connections.filter((c) => c.status === "active");
  const pool = active.length > 0 ? active : connections;
  return pool.reduce((newest, c) =>
    new Date(c.updated_at) > new Date(newest.updated_at) ? c : newest
  );
}

export type SendDecision<T> =
  | { kind: "use"; connection: T }
  | { kind: "blocked"; code: BlockedCode };

// Decide what to do for an artist with these connections: send through a
// working one, or refuse and say why. Never anything else.
export function decideSend<T extends ConnectionStatusInfo>(connections: T[]): SendDecision<T> {
  const active = connections.filter((c) => c.status === "active");
  if (active.length > 0) {
    return { kind: "use", connection: pickConnection(active) as T };
  }
  return { kind: "blocked", code: connections.length > 0 ? "needs_reconnect" : "not_connected" };
}

// Whether the artist can send at all — used by the screens to warn up front.
export function canSendEmail(connections: { status: string }[]): boolean {
  return connections.some((c) => c.status === "active");
}
