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
    // Scoped narrowly to /venues/profile/ — NOT a blanket "/venues/" prefix, which
    // would also expose the private /venues/import and /venues/[id] pages.
    pathname.startsWith("/venues/profile/") ||
    pathname.startsWith("/api/public/") ||
    pathname === "/api/calendar/ics" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/api/auth/validate-code" ||
    pathname === "/api/auth/confirm" ||
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
      // A fully-provisioned venue account's entire app surface (for now)
      // is /venue/profile — this catches every OTHER protected path a
      // venue might land on, most importantly /dashboard, which every
      // login goes through first (app/login/page.tsx always pushes
      // there). Without this, a venue signing back in after their first
      // session would render the artist dashboard instead — the wizard's
      // own explicit redirect on first signup only covers that one path.
      // Widened from an exact match on "/venue/profile" to a prefix match
      // on "/venue/" so new venue-facing pages (like /venue/discover) don't
      // need a middleware change each time one's added. Safe against
      // false-matching "/venues/signup" or "/venues" — those are a
      // different path segment ("/venues/", plural) entirely.
      if (venueProfile.venue_name && !pathname.startsWith("/venue/")) {
        const url = request.nextUrl.clone();
        url.pathname = "/venue/profile";
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
