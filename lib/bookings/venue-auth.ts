import { SupabaseClient } from "@supabase/supabase-js";

// Resolves the calling user's own venue account, but only if they've
// finished signup (venue_name is set) — every booking-requests route
// needs this exact check before touching any booking_requests row, since
// the table itself carries no RLS policies (see
// supabase/migrations/019_booking_requests.sql's header comment).
export async function getOwnCompletedVenueProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("venue_profiles")
    .select("id, venue_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || !data.venue_name) return null;
  return { id: data.id as string };
}
