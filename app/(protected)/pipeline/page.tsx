import { createClient } from "@/lib/supabase/server";
import PipelineView from "@/components/pipeline/PipelineView";
import { Venue, VenueStage } from "@/types";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: venues } = await supabase
    .from("venues")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: true });

  // Get interaction counts per venue
  const { data: interactions } = await supabase
    .from("interactions")
    .select("venue_id, type, occurred_at")
    .eq("user_id", user!.id);

  // Build a map: venue_id → { count, lastDate }
  const outreachMap: Record<string, { count: number; lastDate: string | null }> = {};
  for (const i of interactions ?? []) {
    if (!outreachMap[i.venue_id]) outreachMap[i.venue_id] = { count: 0, lastDate: null };
    outreachMap[i.venue_id].count++;
    if (!outreachMap[i.venue_id].lastDate || i.occurred_at > outreachMap[i.venue_id].lastDate!) {
      outreachMap[i.venue_id].lastDate = i.occurred_at;
    }
  }

  const { stage } = await searchParams;

  return (
    <PipelineView
      initialVenues={(venues as Venue[]) ?? []}
      initialStageFilter={(stage as VenueStage) ?? null}
      outreachMap={outreachMap}
    />
  );
}
