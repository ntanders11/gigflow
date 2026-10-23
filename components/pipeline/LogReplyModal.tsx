"use client";

import { useState } from "react";
import { Venue } from "@/types";
import { remindOptions } from "@/lib/venues/remind-dates";

interface Props {
  venue: Venue;
  onClose: () => void;
  onLogged: (updatedVenueId: string) => void;
}

const HOW_OPTIONS = [
  { key: "email",     label: "Email" },
  { key: "call",      label: "Phone call" },
  { key: "in_person", label: "In person" },
] as const;

type HowKey = typeof HOW_OPTIONS[number]["key"];

export default function LogReplyModal({ venue, onClose, onLogged }: Props) {
  const [how, setHow]     = useState<HowKey>("email");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  // "They said not now": park the venue as Dormant with a date to check back
  const options = remindOptions();
  const [later, setLater]     = useState(false);
  const [remindOn, setRemindOn] = useState(options[2].date);

  async function handleSave() {
    setSaving(true);
    setError("");

    try {
      // 1. Log a "reply" interaction
      const howLabel = how === "in_person" ? "in person" : how;
      const noteText = notes.trim()
        ? `[via ${howLabel}] ${notes.trim()}`
        : `They replied via ${howLabel}.`;

      const interRes = await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_id: venue.id,
          type: "reply",
          notes: noteText,
        }),
      });

      if (!interRes.ok) throw new Error("Failed to log interaction");

      // 2. Move venue to "responded"
      const stageRes = await fetch(`/api/venues/${venue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          later
            ? { stage: "dormant", remind_on: remindOn, remind_note: notes.trim() || null, remind_notified_at: null }
            : { stage: "responded" }
        ),
      });

      if (!stageRes.ok) throw new Error("Failed to update stage");

      onLogged(venue.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-5 space-y-4"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>
              Log Reply
            </p>
            <p className="text-xs mt-0.5" style={{ color: "#9a9591" }}>
              {venue.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none"
            style={{ color: "#5e5c58" }}
          >
            ×
          </button>
        </div>

        {/* How did they reply? */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "#9a9591" }}>
            How did they reach out?
          </p>
          <div className="flex gap-2">
            {HOW_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setHow(opt.key)}
                className="flex-1 text-xs py-2 rounded-lg font-medium transition-all"
                style={
                  how === opt.key
                    ? { backgroundColor: "rgba(76,175,125,0.2)", color: "#4caf7d", border: "1px solid rgba(76,175,125,0.4)" }
                    : { backgroundColor: "#1e2128", color: "#9a9591", border: "1px solid rgba(255,255,255,0.08)" }
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "#9a9591" }}>
            What did they say? <span style={{ color: "#5e5c58" }}>(optional)</span>
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. Interested in July dates, said to follow up next month…"
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
            style={{
              backgroundColor: "#1e2128",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#F4E8D2",
            }}
          />
        </div>

        {/* They said "not now" */}
        <div>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "#F4E8D2" }}>
            <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />
            They said not now — remind me to check back
          </label>
          {later && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                {options.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setRemindOn(o.date)}
                    className="text-xs px-3 py-1.5 rounded-lg"
                    style={{
                      backgroundColor: remindOn === o.date ? "#D4A64F" : "#1e2128",
                      color: remindOn === o.date ? "#0E0E10" : "#F4E8D2",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={remindOn}
                onChange={(e) => setRemindOn(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.08)", color: "#F4E8D2" }}
              />
              <p className="text-xs" style={{ color: "#5e5c58" }}>
                Moves the venue to Dormant (not Responded). What you wrote above becomes the reminder note.
              </p>
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs" style={{ color: "#e25c5c" }}>{error}</p>
        )}

        {/* Footer */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 text-xs py-2.5 rounded-lg transition-all"
            style={{ backgroundColor: "#1e2128", color: "#9a9591", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-2 text-xs py-2.5 px-5 rounded-lg font-semibold transition-all hover:brightness-110 disabled:opacity-50"
            style={{ backgroundColor: "#4caf7d", color: "#fff", flex: 2 }}
          >
            {saving ? "Saving…" : "Log Reply & Move to Responded →"}
          </button>
        </div>
      </div>
    </div>
  );
}
