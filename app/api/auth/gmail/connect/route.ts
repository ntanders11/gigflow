import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { GMAIL_SCOPES } from "@/lib/email/gmail";

export async function GET() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/gmail`;
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  const response = NextResponse.redirect(url);
  response.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    maxAge: 600, // 10 minutes — long enough to finish the consent flow, short enough to limit exposure
    path: "/",
    sameSite: "lax",
  });
  return response;
}
