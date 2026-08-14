import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase's email confirmation links (for both artist and venue signup)
// land here with a `?code=...&next=...` — the code has to be exchanged
// for a real session server-side (createClient() here is the cookie-based
// client, so the session cookie gets set on the response) before
// redirecting on to wherever signup should continue. Without this route,
// clicking a confirmation link does nothing — the code just sits unused
// in the URL and the visitor is never actually logged in.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/login";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("error", "confirmation_failed");
  return NextResponse.redirect(url);
}
