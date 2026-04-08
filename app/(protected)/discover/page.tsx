import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DiscoverView from "@/components/discover/DiscoverView";

export default async function DiscoverPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen p-8" style={{ backgroundColor: "#0e0f11", color: "#f0ede8" }}>
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#f0ede8" }}>
            Discover Venues
          </h1>
        </div>
        <p className="text-sm mb-8" style={{ color: "#5e5c58" }}>
          Search for local venues and add them to your pipeline with one click.
        </p>
        <DiscoverView />
      </div>
    </div>
  );
}
