import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode, fetchConnectedEmail, OUTLOOK_SCOPE, OUTLOOK_READ_SCOPE, hasReadScope } from "@/lib/email/outlook";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/artist-profile?error=no_code", req.url));
  }

  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("outlook_oauth_state")?.value;
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/artist-profile?error=invalid_state", req.url));
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/outlook`;

  const wantsReadMail = req.cookies.get("outlook_reply_detection")?.value === "1";

  let tokens;
  try {
    tokens = await exchangeCode(code, redirectUri, wantsReadMail ? OUTLOOK_READ_SCOPE : OUTLOOK_SCOPE);
  } catch (err) {
    console.error("outlook callback: token exchange failed", err);
    return NextResponse.redirect(new URL("/artist-profile?error=token_failed", req.url));
  }

  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/artist-profile?error=no_refresh_token", req.url));
  }

  let connectedEmail: string;
  try {
    connectedEmail = await fetchConnectedEmail(tokens.access_token);
  } catch (err) {
    console.error("outlook callback: failed to fetch connected email", err);
    return NextResponse.redirect(new URL("/artist-profile?error=token_failed", req.url));
  }

  const { error: upsertError } = await supabase
    .from("email_connections")
    .upsert(
      {
        user_id: user.id,
        provider: "outlook",
        connected_email: connectedEmail,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scope: tokens.scope ?? (wantsReadMail ? OUTLOOK_READ_SCOPE : OUTLOOK_SCOPE),
        status: "active",
        // Reply detection turns on only if Microsoft really granted Mail.Read.
        ...(wantsReadMail && hasReadScope(tokens.scope ?? OUTLOOK_READ_SCOPE)
          ? {
              reply_detection_enabled: true,
              // First scan looks back two weeks so replies already waiting are found.
              reply_scan_cursor: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
            }
          : {}),
      },
      { onConflict: "user_id,provider" }
    );

  if (upsertError) {
    console.error("outlook callback: failed to save connection", upsertError.message);
    return NextResponse.redirect(new URL("/artist-profile?error=save_failed", req.url));
  }

  const response = NextResponse.redirect(new URL("/artist-profile?connected=outlook", req.url));
  response.cookies.delete("outlook_oauth_state");
  response.cookies.delete("outlook_reply_detection");
  return response;
}
