"use client";

import { useState } from "react";
import { Venue } from "@/types";
import { remindOptions } from "@/lib/venues/remind-dates";

interface Props {
  venue: Venue;
  // A date suggested from a venue's reply (e.g. "not booking until January")
  suggestedDate?: string;
  onClose: () => void;
  onSaved: (updates: Pick<Venue, "stage" | "remind_on" | "remind_note">) => void;
}

// "Not now — remind me": puts the venue aside as Dormant with a date to check
// back in and a short note. The daily job sends the bell notification when the
// date arrives.
export default function RemindLaterModal({ venue, suggestedDate, onClose, onSaved }: Props) {
  const options = remindOptions();
  const [date, setDate] = useState(suggestedDate ?? venue.remind_on ?? options[2].date);
  const [note, setNote] = useState(venue.remind_note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!date) return;
    setSaving(true);
    setError("");
    try {
      const cleanNote = note.trim() || null;
      const res = await fetch(`/api/venues/${venue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "dormant", remind_on: date, remind_note: cleanNote, remind_notified_at: null }),
      });
      if (!res.ok) throw new Error("Couldn't save the reminder");
      // A line in the venue's history so the reason isn't lost.
      await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_id: venue.id,
          type: "note",
          notes: `Not now — reminder set for ${date}${cleanNote ? `: ${cleanNote}` : ""}`,
        }),
      }).catch(() => {});
      onSaved({ stage: "dormant", remind_on: date, remind_note: cleanNote });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const label = { color: "#9a9591" };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-xl p-5 space-y-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>Not now — remind me</p>
            <p className="text-xs mt-0.5" style={label}>{venue.name}</p>
          </div>
          <button onClick={onClose} className="text-lg leading-none" style={{ color: "#5e5c58" }}>×</button>
        </div>

        <div>
          <p className="text-xs font-medium mb-2" style={label}>Remind me on…</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setDate(o.date)}
                className="text-xs px-3 py-1.5 rounded-lg transition-all"
                style={{
                  backgroundColor: date === o.date ? "#D4A64F" : "#1e2128",
                  color: date === o.date ? "#0E0E10" : "#F4E8D2",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2" }}
          />
        </div>

        <div>
          <p className="text-xs font-medium mb-2" style={label}>Note (optional)</p>
          <input
            type="text"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. not booking music until spring"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2" }}
          />
        </div>

        <p className="text-xs" style={label}>The venue moves to Dormant now, then back to Contacted with a notification on that day.</p>
        {error && <p className="text-xs" style={{ color: "#e25c5c" }}>{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving || !date}
            className="flex-1 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
          >
            {saving ? "Saving…" : "Set reminder"}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#9a9591" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
