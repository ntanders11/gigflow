// lib/bookings/pipeline.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMatchKey } from "@/lib/venues/matching";

export type EnsureLinkedBookedVenueResult =
  | { venueId: string }
  | { error: string };

// Finds or creates the artist's pipeline `venues` row for this venue
// account, and sets its stage to "booked" — whether it was just created
// or already existed unlinked — since a confirmed Gig is being placed on
// it in the same operation regardless of whatever stage it was
// previously at (e.g. "contacted" or "negotiating"). This overwrite is
// intentional: a real accepted booking is the strongest possible
// pipeline signal.
export async function ensureLinkedBookedVenue(
  service: SupabaseClient,
  opts: { artistUserId: string; venueProfileId: string }
): Promise<EnsureLinkedBookedVenueResult> {
  // 1. Already linked to this exact venue account?
  const { data: linked, error: linkedError } = await service
    .from("venues")
    .select("id")
    .eq("user_id", opts.artistUserId)
    .eq("venue_profile_id", opts.venueProfileId)
    .maybeSingle();
  if (linkedError) return { error: linkedError.message };

  if (linked) {
    const { error: updateError } = await service
      .from("venues")
      .update({ stage: "booked" })
      .eq("id", linked.id);
    if (updateError) return { error: updateError.message };
    return { venueId: linked.id as string };
  }

  // 2. Load the venue account's real info to match/create against.
  const { data: venueProfile, error: profileError } = await service
    .from("venue_profiles")
    .select("venue_name, city, venue_type, address, contact_email, contact_phone")
    .eq("id", opts.venueProfileId)
    .single();
  if (profileError) return { error: profileError.message };
  if (!venueProfile) return { error: "Venue profile not found" };

  // 3. Existing pipeline row matching by name+city, just not yet linked?
  const { data: candidates, error: candidatesError } = await service
    .from("venues")
    .select("id, name, city")
    .eq("user_id", opts.artistUserId)
    .is("venue_profile_id", null);
  if (candidatesError) return { error: candidatesError.message };

  const targetKey = normalizeMatchKey(venueProfile.venue_name as string, venueProfile.city as string | null);
  const match = (candidates ?? []).find(
    (c) => normalizeMatchKey(c.name as string, c.city as string | null) === targetKey
  );

  if (match) {
    const { error: linkError } = await service
      .from("venues")
      .update({ venue_profile_id: opts.venueProfileId, stage: "booked" })
      .eq("id", match.id);
    if (linkError) return { error: linkError.message };
    return { venueId: match.id as string };
  }

  // 4. No match at all — find or create a default zone for this artist,
  // same pattern as POST /api/venues (Discover Venues' "add to pipeline"
  // flow), since a venue arriving via a booking request has no "search
  // zone" context the way one found via Discover Venues does.
  const { data: existingZone, error: zoneSelectError } = await service
    .from("zones")
    .select("id")
    .eq("user_id", opts.artistUserId)
    .limit(1)
    .maybeSingle();
  if (zoneSelectError) return { error: zoneSelectError.message };

  let zone = existingZone;
  if (!zone) {
    const { data: newZone, error: zoneError } = await service
      .from("zones")
      .insert({ user_id: opts.artistUserId, name: "Default", zip_code: null, radius_mi: 50 })
      .select("id")
      .single();
    if (zoneError) return { error: zoneError.message };
    if (!newZone) return { error: "Failed to create a default zone" };
    zone = newZone;
  }

  // 5. Create the new pipeline row, filled in from the venue's real account.
  const { data: created, error: createError } = await service
    .from("venues")
    .insert({
      zone_id: zone!.id,
      user_id: opts.artistUserId,
      name: venueProfile.venue_name as string,
      type: (venueProfile.venue_type as string | null) ?? null,
      city: (venueProfile.city as string | null) ?? null,
      address: (venueProfile.address as string | null) ?? null,
      website: null,
      contact_name: null,
      contact_email: (venueProfile.contact_email as string | null) ?? null,
      contact_phone: (venueProfile.contact_phone as string | null) ?? null,
      stage: "booked",
      confidence: "MEDIUM",
      notes: null,
      venue_profile_id: opts.venueProfileId,
    })
    .select("id")
    .single();
  if (createError || !created) return { error: createError?.message ?? "Failed to create pipeline venue" };

  return { venueId: created.id as string };
}
