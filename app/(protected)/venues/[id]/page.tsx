import { createClient } from "@/lib/supabase/server";
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

  return (
    <VenueDetail
      venue={venue as Venue}
      interactions={(interactions as Interaction[]) ?? []}
      initialGigs={(gigs as Gig[]) ?? []}
    />
  );
}
