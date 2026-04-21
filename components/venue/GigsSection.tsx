"use client";

import { useState } from "react";
import { Gig } from "@/types";

interface Props {
  venueId: string;
  initialGigs: Gig[];
}

const CHECKLIST_ITEMS = [
  { id: "load_in",    label: "Load-in time confirmed" },
  { id: "sound_check",label: "Sound check scheduled" },
  { id: "payment",    label: "Deposit / payment arranged" },
  { id: "set_list",   label: "Set list ready" },
  { id: "equipment",  label: "Equipment packed" },
  { id: "parking",    label: "Parking figured out" },
  { id: "contact",    label: "Point of contact confirmed" },
];

const STATUS_STYLE = {
  upcoming:  { color: "#4caf7d", label: "Upcoming" },
  completed: { color: "#9a9591", label: "Completed" },
  cancelled: { color: "#e25c5c", label: "Cancelled" },
};

function fmt12(time: string | null) {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function fmtDate(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

export default function GigsSection({ venueId, initialGigs }: Props) {
  const [gigs, setGigs] = useState<Gig[]>(initialGigs);
  const [showForm, setShowForm] = useState(false);
  const [expandedGigId, setExpandedGigId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function addGig() {
    if (!date) return;
    setSaving(true);
    const res = await fetch("/api/gigs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venue_id: venueId, date, start_time: startTime || null, end_time: endTime || null, notes: notes || null }),
    });
    const data = await res.json();
    if (res.ok) {
      setGigs((prev) => [...prev, data].sort((a, b) => a.date.localeCompare(b.date)));
      setDate(""); setStartTime(""); setEndTime(""); setNotes("");
      setShowForm(false);
    }
    setSaving(false);
  }

  async function markStatus(id: string, status: Gig["status"]) {
    const res = await fetch(`/api/gigs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setGigs((prev) => prev.map((g) => g.id === id ? { ...g, status } : g));
    }
  }

  async function deleteGig(id: string) {
    const res = await fetch(`/api/gigs/${id}`, { method: "DELETE" });
    if (res.ok) setGigs((prev) => prev.filter((g) => g.id !== id));
  }

  async function toggleChecklistItem(gig: Gig, itemId: string) {
    const current: string[] = (gig as any).checklist ?? [];
    const updated = current.includes(itemId)
      ? current.filter((i) => i !== itemId)
      : [...current, itemId];

    setGigs((prev) =>
      prev.map((g) => g.id === gig.id ? { ...g, checklist: updated } as any : g)
    );

    await fetch(`/api/gigs/${gig.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checklist: updated }),
    });
  }

  const inputStyle = {
    background: "#262b33",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#f0ede8",
    borderRadius: "8px",
    padding: "6px 10px",
    fontSize: "13px",
    outline: "none",
  };

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#5e5c58" }}>
          Gig Dates
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:brightness-110"
          style={{ background: "#d4a853", color: "#0e0f11" }}
        >
          + Add Gig Date
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="rounded-lg p-4 mb-4 space-y-3" style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Happy hour, private event…" style={{ ...inputStyle, width: "100%" }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Start Time</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>End Time</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={addGig}
              disabled={!date || saving}
              className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
              style={{ background: "#d4a853", color: "#0e0f11" }}
            >
              {saving ? "Saving…" : "Save Gig"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-xs px-4 py-1.5 rounded-lg"
              style={{ color: "#9a9591" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Gig list */}
      {gigs.length === 0 ? (
        <p className="text-sm" style={{ color: "#5e5c58" }}>No gig dates scheduled yet.</p>
      ) : (
        <div className="space-y-2">
          {gigs.map((gig) => {
            const s = STATUS_STYLE[gig.status];
            const start = fmt12(gig.start_time);
            const end = fmt12(gig.end_time);
            const checklist: string[] = (gig as any).checklist ?? [];
            const doneCount = CHECKLIST_ITEMS.filter((i) => checklist.includes(i.id)).length;
            const total = CHECKLIST_ITEMS.length;
            const isExpanded = expandedGigId === gig.id;
            const allDone = doneCount === total;

            return (
              <div
                key={gig.id}
                className="rounded-lg overflow-hidden"
                style={{
                  background: "#1e2128",
                  borderLeft: `3px solid ${s.color}`,
                  opacity: gig.status === "cancelled" ? 0.5 : 1,
                }}
              >
                {/* Main row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: "#f0ede8" }}>
                      {fmtDate(gig.date)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#9a9591" }}>
                      {start ? `${start}${end ? ` – ${end}` : ""}` : "No time set"}
                      {gig.notes ? ` · ${gig.notes}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Checklist progress badge */}
                    {gig.status === "upcoming" && (
                      <button
                        onClick={() => setExpandedGigId(isExpanded ? null : gig.id)}
                        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg transition-all hover:brightness-125"
                        style={{
                          background: allDone ? "rgba(76,175,125,0.15)" : "rgba(255,255,255,0.05)",
                          color: allDone ? "#4caf7d" : "#9a9591",
                          border: `1px solid ${allDone ? "rgba(76,175,125,0.3)" : "rgba(255,255,255,0.08)"}`,
                        }}
                      >
                        <span>{allDone ? "✓" : "☐"}</span>
                        <span>{doneCount}/{total} prep</span>
                      </button>
                    )}

                    {gig.status === "upcoming" && (
                      <button
                        onClick={() => markStatus(gig.id, "completed")}
                        className="text-xs px-2 py-1 rounded-lg transition-all hover:brightness-125"
                        style={{ background: "rgba(76,175,125,0.15)", color: "#4caf7d", border: "1px solid rgba(76,175,125,0.3)" }}
                      >
                        ✓ Done
                      </button>
                    )}
                    {gig.status === "completed" && (
                      <span className="text-xs px-2 py-1 rounded-lg" style={{ background: "rgba(154,149,145,0.15)", color: "#9a9591" }}>
                        ✓ Completed
                      </span>
                    )}
                    <button
                      onClick={() => deleteGig(gig.id)}
                      className="text-xs px-2 py-1 rounded-lg transition-all hover:brightness-125"
                      style={{ background: "rgba(226,92,92,0.1)", color: "#e25c5c" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Expandable checklist */}
                {isExpanded && (
                  <div
                    className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-2"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    {CHECKLIST_ITEMS.map((item) => {
                      const checked = checklist.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          onClick={() => toggleChecklistItem(gig, item.id)}
                          className="flex items-center gap-2 text-left text-xs py-1.5 px-2 rounded-lg transition-all hover:brightness-125"
                          style={{
                            background: checked ? "rgba(76,175,125,0.1)" : "rgba(255,255,255,0.03)",
                            color: checked ? "#4caf7d" : "#9a9591",
                            border: `1px solid ${checked ? "rgba(76,175,125,0.25)" : "rgba(255,255,255,0.06)"}`,
                          }}
                        >
                          <span className="text-base leading-none">{checked ? "✓" : "○"}</span>
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
