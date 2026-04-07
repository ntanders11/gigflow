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

  const { stage } = await searchParams;

  return (
    <PipelineView
      initialVenues={(venues as Venue[]) ?? []}
      initialStageFilter={(stage as VenueStage) ?? null}
    />
  );
}
