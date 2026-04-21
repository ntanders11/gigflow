"use client";

import { useState } from "react";
import Link from "next/link";
import PitchEmailModal from "@/components/venue/PitchEmailModal";

interface VenueSummary {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
  contact_email: string | null;
  contact_name: string | null;
  last_contacted_at: string | null;
  // other venue fields needed by PitchEmailModal
  [key: string]: any;
}

const TYPE_COLORS: Record<string, string> = {
  bar:        "#d4a853",
  brewery:    "#e09b50",
  restaurant: "#4caf7d",
  cafe:       "#5b9bd5",
  club:       "#9b7fe8",
  winery:     "#c06080",
  hotel:      "#5b9bd5",
  venue:      "#9a9591",
};

function typeColor(type: string | null): string {
  if (!type) return "#9a9591";
  return TYPE_COLORS[type.toLowerCase()] ?? "#9a9591";
}

export default function NeedsAttentionSection({ venues }: { venues: VenueSummary[] }) {
  const [list, setList] = useState(venues);
  const [emailVenue, setEmailVenue] = useState<VenueSummary | null>(null);

  function handleSent() {
    // Remove the venue from the list once a follow-up is sent
    if (emailVenue) {
      setList((prev) => prev.filter((v) => v.id !== emailVenue.id));
    }
    setEmailVenue(null);
  }

  return (
    <>
      {emailVenue && (
        <PitchEmailModal
          venue={emailVenue as any}
          followUp
          onClose={() => setEmailVenue(null)}
          onSuccess={handleSent}
        />
      )}

      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: "#16181c",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {list.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-medium mb-1" style={{ color: "#4caf7d" }}>
              You&apos;re all caught up!
            </p>
            <p className="text-xs" style={{ color: "#5e5c58" }}>
              No contacted venues have been waiting more than 5 days.
            </p>
          </div>
        ) : (
          list.map((venue, idx) => {
            const iconColor = typeColor(venue.type);
            const firstLetter = (venue.type ?? "V")[0].toUpperCase();
            const isLast = idx === list.length - 1;
            const daysSince = Math.floor(
              (Date.now() - new Date(venue.last_contacted_at!).getTime()) /
                (1000 * 60 * 60 * 24)
            );

            return (
              <div
                key={venue.id}
                className="flex items-center gap-4 px-5 py-4 transition-all hover:brightness-110"
                style={{
                  borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                  borderLeft: "3px solid #e25c5c",
                }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-sm"
                  style={{ backgroundColor: `${iconColor}22`, color: iconColor }}
                >
                  <span style={{ fontWeight: 800 }}>{firstLetter}</span>
                </div>

                <Link href={`/venues/${venue.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "#f0ede8" }}>
                    {venue.name}
                  </p>
                  <p className="text-xs truncate" style={{ color: "#9a9591" }}>
                    {[venue.type, venue.city].filter(Boolean).join(" · ")}
                  </p>
                </Link>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-medium" style={{ color: "#e25c5c" }}>
                    {daysSince}d ago
                  </span>
                  <button
                    onClick={() => setEmailVenue(venue)}
                    className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all hover:brightness-125"
                    style={{
                      backgroundColor: "rgba(212,168,83,0.12)",
                      color: "#d4a853",
                      border: "1px solid rgba(212,168,83,0.25)",
                    }}
                  >
                    ✉ Follow up
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
