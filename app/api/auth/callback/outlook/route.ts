import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/calendar?error=no_code", req.url));
  }

  const clientId = process.env.AZURE_CLIENT_ID!;
  const clientSecret = process.env.AZURE_CLIENT_SECRET!;
  const tenantId = process.env.AZURE_TENANT_ID!;
  const redirectUri = "http://localhost:3000/api/auth/callback/outlook";

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "Calendars.ReadWrite offline_access",
      }),
    }
  );

  if (!res.ok) {
    return NextResponse.redirect(new URL("/calendar?error=token_failed", req.url));
  }

  const tokens = await res.json();
  const response = NextResponse.redirect(new URL("/calendar?connected=1", req.url));

  // Store tokens in httpOnly cookies (expires in 90 days)
  const maxAge = 60 * 60 * 24 * 90;
  response.cookies.set("outlook_access_token", tokens.access_token, {
    httpOnly: true,
    maxAge,
    path: "/",
  });
  if (tokens.refresh_token) {
    response.cookies.set("outlook_refresh_token", tokens.refresh_token, {
      httpOnly: true,
      maxAge,
      path: "/",
    });
  }

  return response;
}
