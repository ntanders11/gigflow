"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PublicRatingsResponse } from "@/types";

// A compact "your own ratings, at a glance" card for the private
// artist-profile / venue-profile pages — reuses the same public ratings
// endpoints the public /profile/[id] and /venues/profile/[id] pages
// already read (components/ratings/RatingsSection.tsx), just showing the
// average + count instead of the full review list, with a link out to the
// existing Ratings page for the rest.
export default function RatingsSummaryCard({ endpoint, viewAllHref }: { endpoint: string; viewAllHref: string }) {
  const [data, setData] = useState<PublicRatingsResponse | null>(null);

  useEffect(() => {
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [endpoint]);

  const hasRatings = !!data && data.count > 0;

  return (
    <div className="rounded-xl p-4 text-center" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div style={{ fontSize: "9px", color: "#5e5c58", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
        Ratings
      </div>
      {hasRatings ? (
        <>
          <p style={{ color: "#D4A64F", fontSize: "16px", marginBottom: "2px" }}>
            {"★".repeat(Math.round(data!.average ?? 0))}
            {"☆".repeat(5 - Math.round(data!.average ?? 0))}
          </p>
          <p style={{ color: "#9a9591", fontSize: "11px", marginBottom: "10px" }}>
            {data!.average?.toFixed(1)} · {data!.count} rating{data!.count !== 1 ? "s" : ""}
          </p>
        </>
      ) : (
        <p style={{ color: "#5e5c58", fontSize: "11px", marginBottom: "10px" }}>
          {data ? "No ratings yet" : "Loading…"}
        </p>
      )}
      <Link href={viewAllHref} className="text-xs transition-all hover:brightness-125" style={{ color: "#D4A64F" }}>
        View all reviews →
      </Link>
    </div>
  );
}
