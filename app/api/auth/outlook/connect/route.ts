import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { OUTLOOK_SCOPE, OUTLOOK_READ_SCOPE } from "@/lib/email/outlook";

export async function GET(req: NextRequest) {
  // ?reply_detection=1: the artist opted in to reply detection, so also ask for
  // permission to read mail. Ordinary connects keep the original permissions.
  const wantsReadMail = req.nextUrl.searchParams.get("reply_detection") === "1";
  const clientId = process.env.AZURE_CLIENT_ID!;
  const tenantId = process.env.AZURE_TENANT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/outlook`;
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: wantsReadMail ? OUTLOOK_READ_SCOPE : OUTLOOK_SCOPE,
    prompt: "consent",
    state,
  });

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
  const response = NextResponse.redirect(url);
  response.cookies.set("outlook_oauth_state", state, {
    httpOnly: true,
    maxAge: 600,
    path: "/",
    sameSite: "lax",
  });
  if (wantsReadMail) {
    response.cookies.set("outlook_reply_detection", "1", { httpOnly: true, maxAge: 600, path: "/", sameSite: "lax" });
  }
  return response;
}
