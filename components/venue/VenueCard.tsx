"use client";

import Link from "next/link";
import { Draggable } from "@hello-pangea/dnd";
import { Venue } from "@/types";
import { cn } from "@/lib/utils";

// Dark-theme confidence colors using inline styles
const CONFIDENCE_DARK: Record<string, { bg: string; color: string; border: string; label: string }> = {
  HIGH: { bg: "rgba(76,175,125,0.1)", color: "#4caf7d", border: "rgba(76,175,125,0.3)", label: "HIGH" },
  MEDIUM: { bg: "rgba(212,168,83,0.1)", color: "#d4a853", border: "rgba(212,168,83,0.3)", label: "MEDIUM" },
  LOW: { bg: "rgba(226,92,92,0.1)", color: "#e25c5c", border: "rgba(226,92,92,0.3)", label: "LOW" },
};

interface Props {
  venue: Venue;
  index: number;
  onReply: (venueId: string) => void;
}

export default function VenueCard({ venue, index, onReply }: Props) {
  const conf = CONFIDENCE_DARK[venue.confidence] ?? CONFIDENCE_DARK.LOW;

  return (
    <Draggable draggableId={venue.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="rounded-lg p-3 cursor-pointer select-none transition-shadow"
          style={{
            ...provided.draggableProps.style,
            backgroundColor: "#16181c",
            border: snapshot.isDragging
              ? "1px solid rgba(255,255,255,0.12)"
              : "1px solid rgba(255,255,255,0.07)",
            boxShadow: snapshot.isDragging
              ? "0 8px 24px rgba(0,0,0,0.4)"
              : "none",
          }}
        >
          <Link href={`/venues/${venue.id}`} onClick={(e) => e.stopPropagation()}>
            <p
              className="font-medium text-sm leading-snug hover:underline"
              style={{ color: "#ffffff" }}
            >
              {venue.name}
            </p>
          </Link>

          <p className="text-xs mt-0.5" style={{ color: "#9a9591" }}>
            {[venue.type, venue.city].filter(Boolean).join(" · ")}
          </p>

          {venue.live_music_details && (
            <p className="text-xs mt-1 line-clamp-1" style={{ color: "#5e5c58" }}>
              {venue.live_music_details}
            </p>
          )}

          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span
              className="text-xs px-1.5 py-0.5 rounded border font-medium"
              style={{
                backgroundColor: conf.bg,
                color: conf.color,
                borderColor: conf.border,
              }}
            >
              {conf.label}
            </span>
            {venue.contact_email && (
              <span className="text-xs" style={{ color: "#5e5c58" }}>
                has email
              </span>
            )}
            {venue.stage === "contacted" && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onReply(venue.id);
                }}
                className="text-xs px-1.5 py-0.5 rounded font-medium transition-all hover:brightness-125 ml-auto"
                style={{
                  backgroundColor: "rgba(155,127,232,0.15)",
                  color: "#9b7fe8",
                  border: "1px solid rgba(155,127,232,0.3)",
                }}
              >
                They replied ↩
              </button>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}
