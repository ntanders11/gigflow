import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component — safe to ignore
          }
        },
      },
    }
  );
}

// Deliberately NOT built on createServerClient (the @supabase/ssr cookie-aware
// helper) like createClient() above. That helper persists and recovers a
// session from cookies, and once a session exists, supabase-js uses the
// session's own access token for every request's Authorization header
// instead of the key passed at construction time — meaning a "service role"
// client built that way silently ends up authenticating as whichever user's
// session cookies are present on the request, not as the service role,
// defeating RLS bypass entirely with no error to signal it. This was a real
// production bug: cross-artist reads/writes (the venue search, the
// cross-pipeline linking sweep, the Discover Venues badge lookup) all
// silently returned nothing instead of bypassing RLS, discovered via live
// testing on 2026-08-14. Using the plain, cookie-free client from
// @supabase/supabase-js directly (persistSession/autoRefreshToken both off)
// guarantees every request from this client is authenticated purely by the
// service role key, with no session state to inherit from anywhere.
export async function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
