import { createClient } from "@/lib/supabase/server";
import PipelineView from "@/components/pipeline/PipelineView";
import { Venue } from "@/types";

export default async function PipelinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: venues } = await supabase
    .from("venues")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: true });

  return <PipelineView initialVenues={(venues as Venue[]) ?? []} />;
}
