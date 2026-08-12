import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode, fetchConnectedEmail, GMAIL_SCOPES } from "@/lib/email/gmail";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/artist-profile?error=no_code", req.url));
  }

  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("gmail_oauth_state")?.value;
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/artist-profile?error=invalid_state", req.url));
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/gmail`;

  let tokens;
  try {
    tokens = await exchangeCode(code, redirectUri);
  } catch (err) {
    console.error("gmail callback: token exchange failed", err);
    return NextResponse.redirect(new URL("/artist-profile?error=token_failed", req.url));
  }

  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/artist-profile?error=no_refresh_token", req.url));
  }

  let connectedEmail: string;
  try {
    connectedEmail = await fetchConnectedEmail(tokens.access_token);
  } catch (err) {
    console.error("gmail callback: failed to fetch connected email", err);
    return NextResponse.redirect(new URL("/artist-profile?error=token_failed", req.url));
  }

  const { error: upsertError } = await supabase
    .from("email_connections")
    .upsert(
      {
        user_id: user.id,
        provider: "gmail",
        connected_email: connectedEmail,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scope: tokens.scope ?? GMAIL_SCOPES,
        status: "active",
      },
      { onConflict: "user_id,provider" }
    );

  if (upsertError) {
    console.error("gmail callback: failed to save connection", upsertError.message);
    return NextResponse.redirect(new URL("/artist-profile?error=save_failed", req.url));
  }

  const response = NextResponse.redirect(new URL("/artist-profile?connected=gmail", req.url));
  response.cookies.delete("gmail_oauth_state");
  return response;
}
