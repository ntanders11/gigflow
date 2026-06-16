"use client";

import Link from "next/link";
import { Draggable } from "@hello-pangea/dnd";
import { Venue, OutreachInfo } from "@/types";

// Dark-theme confidence colors using inline styles
const CONFIDENCE_DARK: Record<string, { bg: string; color: string; border: string; label: string }> = {
  HIGH: { bg: "rgba(76,175,125,0.1)", color: "#4caf7d", border: "rgba(76,175,125,0.3)", label: "HIGH" },
  MEDIUM: { bg: "rgba(212,166,79,0.1)", color: "#D4A64F", border: "rgba(212,166,79,0.3)", label: "MEDIUM" },
  LOW: { bg: "rgba(226,92,92,0.1)", color: "#e25c5c", border: "rgba(226,92,92,0.3)", label: "LOW" },
};

interface Props {
  venue: Venue;
  index: number;
  onReply: (venue: Venue) => void;
  onEmail: (venue: Venue) => void;
  outreach: OutreachInfo | null;
  batchActive?: boolean;
  batchSelected?: boolean;
  batchDisabled?: boolean;
  onBatchToggle?: () => void;
}

function daysAgo(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export default function VenueCard({ venue, index, onReply, onEmail, outreach, batchActive, batchSelected, batchDisabled, onBatchToggle }: Props) {
  const conf = CONFIDENCE_DARK[venue.confidence] ?? CONFIDENCE_DARK.LOW;

  return (
    <Draggable draggableId={venue.id} index={index} isDragDisabled={!!batchActive}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="rounded-lg p-3 select-none transition-shadow relative"
          onClick={batchActive && !batchDisabled ? onBatchToggle : undefined}
          style={{
            ...provided.draggableProps.style,
            backgroundColor: batchSelected ? "rgba(212,166,79,0.08)" : "#16181c",
            border: batchSelected
              ? "1px solid rgba(212,166,79,0.4)"
              : snapshot.isDragging
              ? "1px solid rgba(255,255,255,0.12)"
              : "1px solid rgba(255,255,255,0.07)",
            boxShadow: snapshot.isDragging ? "0 8px 24px rgba(0,0,0,0.4)" : "none",
            opacity: batchDisabled ? 0.55 : 1,
            cursor: batchActive ? (batchDisabled ? "default" : "pointer") : "grab",
          }}
        >
          {/* Batch mode indicator — checkbox if selectable, "No email" badge if not */}
          {batchActive && (
            batchDisabled ? (
              <span
                className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded"
                style={{ backgroundColor: "#1e2128", color: "#5e5c58", fontSize: "10px", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                No email
              </span>
            ) : (
              <div
                className="absolute top-2 right-2 w-4 h-4 rounded flex items-center justify-center"
                style={{
                  backgroundColor: batchSelected ? "#D4A64F" : "transparent",
                  border: `1px solid ${batchSelected ? "#D4A64F" : "rgba(255,255,255,0.2)"}`,
                }}
              >
                {batchSelected && <span style={{ color: "#0E0E10", fontSize: "9px", fontWeight: 700 }}>✓</span>}
              </div>
            )
          )}
          <Link href={`/venues/${venue.id}`} onClick={(e) => { e.stopPropagation(); if (batchActive) e.preventDefault(); }}>
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

            {outreach && outreach.count > 0 && (
              <span className="text-xs" style={{ color: "#5e5c58" }}>
                ✉ {outreach.count}× · {daysAgo(outreach.lastDate)}
              </span>
            )}

            <div className="ml-auto flex items-center gap-1.5">
              {venue.stage === "contacted" && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onReply(venue);
                  }}
                  className="text-xs px-1.5 py-0.5 rounded font-medium transition-all hover:brightness-125"
                  style={{
                    backgroundColor: "rgba(155,127,232,0.15)",
                    color: "#9b7fe8",
                    border: "1px solid rgba(155,127,232,0.3)",
                  }}
                >
                  Got a reply? →
                </button>
              )}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onEmail(venue);
                }}
                className="text-xs px-1.5 py-0.5 rounded font-medium transition-all hover:brightness-125"
                style={{
                  backgroundColor: "rgba(212,166,79,0.12)",
                  color: "#D4A64F",
                  border: "1px solid rgba(212,166,79,0.25)",
                }}
                title="Send email"
              >
                ✉
              </button>
            </div>
          </div>

        </div>
      )}
    </Draggable>
  );
}
