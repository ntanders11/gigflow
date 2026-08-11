import { NextResponse } from "next/server";
import { GMAIL_SCOPES } from "@/lib/email/gmail";

export async function GET() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/gmail`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return NextResponse.redirect(url);
}
