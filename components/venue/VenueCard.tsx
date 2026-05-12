"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Draggable } from "@hello-pangea/dnd";
import { Venue } from "@/types";

// Dark-theme confidence colors using inline styles
const CONFIDENCE_DARK: Record<string, { bg: string; color: string; border: string; label: string }> = {
  HIGH: { bg: "rgba(76,175,125,0.1)", color: "#4caf7d", border: "rgba(76,175,125,0.3)", label: "HIGH" },
  MEDIUM: { bg: "rgba(212,168,83,0.1)", color: "#d4a853", border: "rgba(212,168,83,0.3)", label: "MEDIUM" },
  LOW: { bg: "rgba(226,92,92,0.1)", color: "#e25c5c", border: "rgba(226,92,92,0.3)", label: "LOW" },
};

interface Props {
  venue: Venue;
  index: number;
  onReply: (venue: Venue) => void;
  onEmail: (venue: Venue) => void;
  onEmailSaved: (venueId: string, email: string) => void;
  outreach: { count: number; lastDate: string | null } | null;
}

function daysAgo(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export default function VenueCard({ venue, index, onReply, onEmail, onEmailSaved, outreach }: Props) {
  const conf = CONFIDENCE_DARK[venue.confidence] ?? CONFIDENCE_DARK.LOW;
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function saveEmail() {
    const trimmed = emailInput.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setEditingEmail(false);
      setEmailInput("");
      return;
    }
    setSavingEmail(true);
    try {
      await fetch(`/api/venues/${venue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_email: trimmed }),
      });
      onEmailSaved(venue.id, trimmed);
    } finally {
      setSavingEmail(false);
      setEditingEmail(false);
      setEmailInput("");
    }
  }

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
                  backgroundColor: "rgba(212,168,83,0.12)",
                  color: "#d4a853",
                  border: "1px solid rgba(212,168,83,0.25)",
                }}
                title="Send email"
              >
                ✉
              </button>
            </div>
          </div>

          {/* Inline email entry — shown on Discovered cards with no email */}
          {venue.stage === "discovered" && !venue.contact_email && (
            <div className="mt-2" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              {editingEmail ? (
                <div className="flex gap-1">
                  <input
                    ref={inputRef}
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEmail();
                      if (e.key === "Escape") { setEditingEmail(false); setEmailInput(""); }
                    }}
                    onBlur={() => { if (!savingEmail) { setEditingEmail(false); setEmailInput(""); } }}
                    placeholder="paste email…"
                    autoFocus
                    className="flex-1 min-w-0 text-xs px-2 py-1 rounded focus:outline-none"
                    style={{
                      backgroundColor: "#1e2128",
                      border: "1px solid rgba(212,168,83,0.4)",
                      color: "#f0ede8",
                    }}
                  />
                  <button
                    onMouseDown={(e) => e.preventDefault()} // prevent blur before click
                    onClick={saveEmail}
                    disabled={savingEmail}
                    className="text-xs px-2 py-1 rounded font-medium shrink-0"
                    style={{ backgroundColor: "rgba(212,168,83,0.2)", color: "#d4a853" }}
                  >
                    {savingEmail ? "…" : "✓"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingEmail(true); setTimeout(() => inputRef.current?.focus(), 0); }}
                  className="text-xs transition-all hover:brightness-125"
                  style={{ color: "#5e5c58" }}
                >
                  + add email
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}
