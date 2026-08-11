import { createServiceClient } from "@/lib/supabase/server";
import { TokenRefreshError } from "@/lib/email/errors";

export const OUTLOOK_SCOPE = "Calendars.ReadWrite Mail.Send User.Read offline_access";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

function tokenEndpoint(): string {
  const tenantId = process.env.AZURE_TENANT_ID!;
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AZURE_CLIENT_ID!,
      client_secret: process.env.AZURE_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: OUTLOOK_SCOPE,
    }),
  });

  if (!res.ok) {
    throw new Error(`outlook: code exchange failed (${res.status})`);
  }

  return res.json();
}

export async function fetchConnectedEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error("outlook: failed to fetch connected email");
  }

  const profile = await res.json();
  return profile.mail ?? profile.userPrincipalName;
}

export async function refreshToken(connectionId: string, refreshTokenValue: string): Promise<string> {
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AZURE_CLIENT_ID!,
      client_secret: process.env.AZURE_CLIENT_SECRET!,
      refresh_token: refreshTokenValue,
      grant_type: "refresh_token",
      scope: OUTLOOK_SCOPE,
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
    throw new TokenRefreshError(`outlook: token refresh failed (${res.status}): ${body}`, isAuthFailure);
  }

  const tokens: TokenResponse = await res.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const supabase = await createServiceClient();
  await supabase
    .from("email_connections")
    .update({
      access_token: tokens.access_token,
      expires_at: expiresAt,
      // Azure AD rotates the refresh token on nearly every use — always
      // persist the new one, or the next refresh will fail with invalid_grant.
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    })
    .eq("id", connectionId);

  return tokens.access_token;
}

export async function send({
  accessToken,
  to,
  subject,
  html,
}: {
  accessToken: string;
  to: string;
  subject: string;
  html: string;
}): Promise<
  | { success: true; providerMessageId: null }
  | { success: false; error: string; status: number }
> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    return { success: false, error, status: res.status };
  }

  // Graph's sendMail returns 202 Accepted with no body — nothing to capture.
  return { success: true, providerMessageId: null };
}
