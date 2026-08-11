import { createServiceClient } from "@/lib/supabase/server";
import { TokenRefreshError } from "@/lib/email/errors";

export const GMAIL_SCOPES = "openid email https://www.googleapis.com/auth/gmail.send";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`gmail: code exchange failed (${res.status})`);
  }

  return res.json();
}

export async function fetchConnectedEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error("gmail: failed to fetch connected email");
  }

  const data = await res.json();
  return data.email;
}

export async function refreshToken(connectionId: string, refreshTokenValue: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshTokenValue,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let isAuthFailure = false;
    try {
      isAuthFailure = JSON.parse(body).error === "invalid_grant";
    } catch {
      // Non-JSON error body — treat as transient, not a dead connection.
    }
    throw new TokenRefreshError(`gmail: token refresh failed (${res.status}): ${body}`, isAuthFailure);
  }

  const tokens: TokenResponse = await res.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const supabase = await createServiceClient();
  await supabase
    .from("email_connections")
    .update({
      access_token: tokens.access_token,
      expires_at: expiresAt,
      // Google usually keeps the same refresh token across refreshes, but
      // persist a new one on the rare occasion it issues one.
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    })
    .eq("id", connectionId);

  return tokens.access_token;
}

export async function revokeGmailToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
  });
}

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}

function buildRawMessage({
  from,
  to,
  subject,
  text,
  html,
}: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): string {
  const boundary = "stagereach_boundary";
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function send({
  accessToken,
  from,
  fromName,
  to,
  subject,
  text,
  html,
}: {
  accessToken: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<
  | { success: true; providerMessageId: string }
  | { success: false; error: string; status: number }
> {
  // fromName ultimately comes from artist_profiles.display_name, which is free-text —
  // strip characters that would break a hand-built MIME header (send-email/route.ts
  // does the same sanitization; doing it here too means every caller of gmail.send
  // gets it for free, including the automated follow-up cron in Task 10).
  const safeFromName = fromName.replace(/[<>"]/g, "").trim();
  const raw = buildRawMessage({ from: `${safeFromName} <${from}>`, to, subject, text, html });

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const error = await res.text();
    return { success: false, error, status: res.status };
  }

  const data = await res.json();
  return { success: true, providerMessageId: data.id };
}
