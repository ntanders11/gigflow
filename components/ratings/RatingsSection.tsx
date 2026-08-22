// components/ratings/RatingsSection.tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PublicRatingsResponse } from "@/types";

export default function RatingsSection({ endpoint, reviewerLinkPrefix }: { endpoint: string; reviewerLinkPrefix: string }) {
  const [data, setData] = useState<PublicRatingsResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [endpoint]);

  if (!data || data.count === 0) return null;

  const visibleReviews = expanded ? data.reviews : data.reviews.slice(0, 3);

  return (
    <div className="mt-8 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
        Ratings
      </h2>
      <p className="text-sm mb-4" style={{ color: "#D4A64F" }}>
        {"★".repeat(Math.round(data.average ?? 0))}
        {"☆".repeat(5 - Math.round(data.average ?? 0))}{" "}
        {data.average?.toFixed(1)} · {data.count} rating{data.count !== 1 ? "s" : ""}
      </p>
      <div className="space-y-3">
        {visibleReviews.map((r, i) => (
          <div key={i} className="rounded-lg p-3" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center gap-2 mb-1">
              <Link href={`${reviewerLinkPrefix}${r.reviewer_id}`} className="flex items-center gap-2 hover:brightness-125 transition-all">
                {r.reviewer_photo_url ? (
                  <img src={r.reviewer_photo_url} alt={r.reviewer_name} className="w-6 h-6 rounded-full object-cover" />
                ) : (
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
                  >
                    {r.reviewer_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-medium" style={{ color: "#F4E8D2" }}>{r.reviewer_name}</span>
              </Link>
              <span className="text-xs" style={{ color: "#D4A64F" }}>
                {"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}
              </span>
            </div>
            {r.review && <p className="text-sm" style={{ color: "#9a9591" }}>{r.review}</p>}
          </div>
        ))}
      </div>
      {!expanded && data.reviews.length > 3 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs mt-3"
          style={{ color: "#5b9bd5" }}
        >
          Load more reviews
        </button>
      )}
    </div>
  );
}
