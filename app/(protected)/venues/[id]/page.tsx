import { createClient, createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Venue, Interaction, Gig } from "@/types";
import VenueDetail from "@/components/venue/VenueDetail";

export default async function VenueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: venue } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();

  if (!venue) notFound();

  const { data: interactions } = await supabase
    .from("interactions")
    .select("*")
    .eq("venue_id", id)
    .order("occurred_at", { ascending: false });

  const { data: gigs } = await supabase
    .from("gigs")
    .select("*")
    .eq("venue_id", id)
    .eq("user_id", user!.id)
    .order("date", { ascending: true });

  // Which of these gigs came from a venue's booking request, rather than
  // being added directly by the artist — only the venue can change the
  // date/time on those (see app/api/gigs/[id]/route.ts's PATCH guard).
  // booking_requests carries no client-facing RLS, so this needs the
  // service-role client even though the gigs read above didn't.
  const gigIds = (gigs ?? []).map((g) => g.id as string);
  let venueOriginatedGigIds: string[] = [];
  if (gigIds.length > 0) {
    const service = await createServiceClient();
    const { data: linkedRequests } = await service
      .from("booking_requests")
      .select("gig_id")
      .in("gig_id", gigIds);
    venueOriginatedGigIds = (linkedRequests ?? []).map((r) => r.gig_id as string);
  }

  return (
    <VenueDetail
      venue={venue as Venue}
      interactions={(interactions as Interaction[]) ?? []}
      initialGigs={(gigs as Gig[]) ?? []}
      venueOriginatedGigIds={venueOriginatedGigIds}
    />
  );
}
