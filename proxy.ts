import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === "/login";
  // Public routes that don't require authentication
  const isPublicRoute =
    pathname.startsWith("/profile/") ||
    pathname === "/api/calendar/ics" ||
    pathname === "/api/auth/validate-code" ||
    pathname === "/signup" ||
    pathname === "/venues" ||
    pathname === "/venues/signup";

  if (!user && !isLoginPage && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Guard: authenticated users who haven't completed onboarding
  // are redirected to /onboarding. Skip this check on /onboarding
  // itself (would cause infinite redirect) and on all API routes.
  const isOnboardingRoute = pathname === "/onboarding";
  const isVenueSignupRoute = pathname === "/venues/signup";
  const isApiRoute = pathname.startsWith("/api/");

  if (user && !isPublicRoute && !isLoginPage && !isOnboardingRoute && !isApiRoute) {
    // Venue accounts are unambiguous — a venue_profiles row only ever
    // exists for a venue account, created the moment signup starts (see
    // /api/venue-profile's POST handler). Check this FIRST: without it,
    // the artist_profiles check below would incorrectly bounce every
    // venue account into the artist onboarding wizard, since a venue
    // never has an artist_profiles row at all. A user can only ever have
    // a row in one of these two tables, so the lookups are independent
    // and safe to run concurrently.
    const [
      { data: venueProfile, error: venueProfileError },
      { data: artistProfile, error: profileError },
    ] = await Promise.all([
      supabase
        .from("venue_profiles")
        .select("venue_name")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("artist_profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    if (venueProfileError) {
      // Can't safely determine account type when the lookup itself
      // failed — fail open rather than risk redirecting a real venue
      // account into the artist onboarding wizard.
      console.error("proxy: venue_profiles lookup failed", venueProfileError);
      return supabaseResponse;
    }

    if (venueProfile) {
      if (!venueProfile.venue_name && !isVenueSignupRoute) {
        const url = request.nextUrl.clone();
        url.pathname = "/venues/signup";
        return NextResponse.redirect(url);
      }
      return supabaseResponse;
    }

    if (!profileError && !artistProfile?.display_name) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
