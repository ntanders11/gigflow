// app/venues/profile/[id]/page.tsx
import { createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { VenueProfile } from "@/types";
import RatingsSection from "@/components/ratings/RatingsSection";

export default async function PublicVenueProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServiceClient();

  const { data: profile } = await supabase
    .from("venue_profiles")
    .select("*")
    .eq("id", id)
    .not("venue_name", "is", null)
    .single();

  if (!profile) notFound();

  const p = profile as VenueProfile;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-start gap-4 mb-6">
          {p.photo_url ? (
            <img src={p.photo_url} alt={p.venue_name ?? ""} className="w-16 h-16 rounded-xl object-cover shrink-0" />
          ) : (
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-xl font-bold shrink-0"
              style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
            >
              {(p.venue_name ?? "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "#F4E8D2" }}>{p.venue_name}</h1>
            <p className="text-sm" style={{ color: "#9a9591" }}>
              {[p.venue_type, p.city].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>

        {p.description && (
          <p className="text-sm mb-6" style={{ color: "#F4E8D2" }}>{p.description}</p>
        )}

        {p.genres.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {p.genres.map((g) => (
              <span
                key={g}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "rgba(212,166,79,0.12)", color: "#D4A64F" }}
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {p.stage_equipment && (
          <div className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: "#5e5c58" }}>
              Stage & Equipment
            </h2>
            <p className="text-sm" style={{ color: "#F4E8D2" }}>{p.stage_equipment}</p>
          </div>
        )}

        <RatingsSection endpoint={`/api/public/venues/${id}/ratings`} reviewerLinkPrefix="/profile/" />
      </div>
    </div>
  );
}
