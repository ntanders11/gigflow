import { createServiceClient } from "@/lib/supabase/server";
import * as gmail from "@/lib/email/gmail";
import * as outlook from "@/lib/email/outlook";
import { TokenRefreshError } from "@/lib/email/errors";
import { BLOCKED_MESSAGES, decideSend, pickConnection, type BlockedCode, type ConnectionStatusInfo } from "@/lib/email/send-rules";

// Re-exported so existing imports (e.g. the diagnostics route) keep working.
export { pickConnection };
export type { ConnectionStatusInfo };

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface SendArtistEmailParams {
  userId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  fromName: string;
  replyTo?: string;
}

export interface SendArtistEmailResult {
  success: boolean;
  provider: "gmail" | "outlook" | null;
  providerMessageId: string | null;
  // Set when success is false. "not_connected" / "needs_reconnect" mean the
  // artist has no working Gmail/Outlook, so nothing was attempted;
  // "send_failed" means their provider refused or errored.
  code?: BlockedCode | "send_failed";
  error?: string;
}

interface EmailConnectionRow {
  id: string;
  provider: "gmail" | "outlook";
  connected_email: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  status: "active" | "needs_reconnect";
  updated_at: string;
}

async function sendViaConnection(
  connection: EmailConnectionRow,
  params: SendArtistEmailParams
): Promise<{ success: boolean; providerMessageId: string | null; authFailure: boolean; error?: string }> {
  let accessToken = connection.access_token;
  const expiresAt = new Date(connection.expires_at).getTime();

  if (expiresAt - Date.now() < REFRESH_BUFFER_MS) {
    try {
      accessToken =
        connection.provider === "gmail"
          ? await gmail.refreshToken(connection.id, connection.refresh_token)
          : await outlook.refreshToken(connection.id, connection.refresh_token);
    } catch (err) {
      // Only a genuine invalid_grant (dead/revoked refresh token) should flag
      // this connection for reconnect — a transient 500 or network blip during
      // refresh shouldn't make a healthy connection look broken.
      const authFailure = err instanceof TokenRefreshError ? err.isAuthFailure : false;
      return { success: false, providerMessageId: null, authFailure, error: `token refresh failed: ${err}` };
    }
  }

  const result =
    connection.provider === "gmail"
      ? await gmail.send({
          accessToken,
          from: connection.connected_email,
          fromName: params.fromName,
          to: params.to,
          subject: params.subject,
          text: params.text,
          html: params.html,
        })
      : await outlook.send({
          accessToken,
          to: params.to,
          subject: params.subject,
          html: params.html,
        });

  if (result.success) {
    return { success: true, providerMessageId: result.providerMessageId, authFailure: false };
  }

  return { success: false, providerMessageId: null, authFailure: result.status === 401, error: result.error };
}

// Sends only through the artist's own connected Gmail/Outlook. There is no
// fallback to the shared StageReach (Resend) sender on purpose: it has a daily
// cap shared by every artist, and a pitch quietly going out from a generic
// address isn't what the artist expects. If nothing works, say so.
export async function sendArtistEmail(params: SendArtistEmailParams): Promise<SendArtistEmailResult> {
  const supabase = await createServiceClient();

  const { data: connections, error: connectionsError } = await supabase
    .from("email_connections")
    .select("id, provider, connected_email, access_token, refresh_token, expires_at, status, updated_at")
    .eq("user_id", params.userId);

  if (connectionsError) {
    console.error(`send-artist-email: failed to look up connections for user ${params.userId}:`, connectionsError.message);
    return { success: false, provider: null, providerMessageId: null, code: "send_failed", error: BLOCKED_MESSAGES.send_failed };
  }

  const decision = decideSend((connections as EmailConnectionRow[]) ?? []);
  if (decision.kind === "blocked") {
    return { success: false, provider: null, providerMessageId: null, code: decision.code, error: BLOCKED_MESSAGES[decision.code] };
  }

  const connection = decision.connection;
  try {
    const result = await sendViaConnection(connection, params);
    if (result.success) {
      return { success: true, provider: connection.provider, providerMessageId: result.providerMessageId };
    }
    if (result.authFailure) {
      await supabase.from("email_connections").update({ status: "needs_reconnect" }).eq("id", connection.id);
    }
    console.error(`send-artist-email: ${connection.provider} send failed for user ${params.userId}:`, result.error);
    return {
      success: false,
      provider: connection.provider,
      providerMessageId: null,
      code: result.authFailure ? "needs_reconnect" : "send_failed",
      error: result.authFailure ? BLOCKED_MESSAGES.needs_reconnect : BLOCKED_MESSAGES.send_failed,
    };
  } catch (err) {
    console.error(`send-artist-email: ${connection.provider} send threw for user ${params.userId}:`, err);
    return { success: false, provider: connection.provider, providerMessageId: null, code: "send_failed", error: BLOCKED_MESSAGES.send_failed };
  }
}
