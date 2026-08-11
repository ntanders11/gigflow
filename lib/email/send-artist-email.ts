import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/server";
import * as gmail from "@/lib/email/gmail";
import * as outlook from "@/lib/email/outlook";
import { TokenRefreshError } from "@/lib/email/errors";

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

interface SendArtistEmailResult {
  success: boolean;
  provider: "gmail" | "outlook" | "resend";
  providerMessageId: string | null;
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

function pickConnection(connections: EmailConnectionRow[]): EmailConnectionRow | null {
  if (connections.length === 0) return null;
  const active = connections.filter((c) => c.status === "active");
  const pool = active.length > 0 ? active : connections;
  return pool.reduce((newest, c) =>
    new Date(c.updated_at) > new Date(newest.updated_at) ? c : newest
  );
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

async function sendViaResend(params: SendArtistEmailParams): Promise<SendArtistEmailResult> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();

  if (!apiKey) {
    console.error("send-artist-email: RESEND_API_KEY is not set");
    return { success: false, provider: "resend", providerMessageId: null, error: "Email service not configured (missing API key)" };
  }
  if (!fromEmail) {
    console.error("send-artist-email: RESEND_FROM_EMAIL is not set");
    return { success: false, provider: "resend", providerMessageId: null, error: "Email service not configured (missing from address)" };
  }

  const fromAddress = params.fromName ? `${params.fromName} <${fromEmail}>` : fromEmail;
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: fromAddress,
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });

  if (error) {
    return { success: false, provider: "resend", providerMessageId: null, error: error.message };
  }

  return { success: true, provider: "resend", providerMessageId: data?.id ?? null };
}

export async function sendArtistEmail(params: SendArtistEmailParams): Promise<SendArtistEmailResult> {
  const supabase = await createServiceClient();

  const { data: connections, error: connectionsError } = await supabase
    .from("email_connections")
    .select("id, provider, connected_email, access_token, refresh_token, expires_at, status, updated_at")
    .eq("user_id", params.userId);

  if (connectionsError) {
    console.error(
      `send-artist-email: failed to look up connections for user ${params.userId}, falling back to Resend:`,
      connectionsError.message
    );
  }

  const connection = pickConnection((connections as EmailConnectionRow[]) ?? []);

  if (connection) {
    try {
      const result = await sendViaConnection(connection, params);
      if (result.success) {
        return { success: true, provider: connection.provider, providerMessageId: result.providerMessageId };
      }
      if (result.authFailure) {
        await supabase.from("email_connections").update({ status: "needs_reconnect" }).eq("id", connection.id);
      }
      console.error(
        `send-artist-email: ${connection.provider} send failed for user ${params.userId}, falling back to Resend:`,
        result.error
      );
    } catch (err) {
      console.error(
        `send-artist-email: ${connection.provider} send threw for user ${params.userId}, falling back to Resend:`,
        err
      );
    }
  }

  try {
    return await sendViaResend(params);
  } catch (err) {
    console.error(`send-artist-email: Resend send threw for user ${params.userId}:`, err);
    return { success: false, provider: "resend", providerMessageId: null, error: `Resend send threw: ${err}` };
  }
}
