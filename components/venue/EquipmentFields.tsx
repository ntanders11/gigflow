"use client";

import { EQUIPMENT_OPTIONS } from "@/lib/venues/equipment";

interface Props {
  provided: string[];
  onProvidedChange: (keys: string[]) => void;
  artistShouldBring: string;
  onArtistShouldBringChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
}

const labelStyle = { color: "#9a9591" };
const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "#F4E8D2",
};

// Shared by the venue signup wizard and /venue/profile so the two can't
// drift apart on which gear options exist or how they're presented.
export default function EquipmentFields({
  provided,
  onProvidedChange,
  artistShouldBring,
  onArtistShouldBringChange,
  notes,
  onNotesChange,
}: Props) {
  function toggle(key: string) {
    onProvidedChange(provided.includes(key) ? provided.filter((k) => k !== key) : [...provided, key]);
  }

  return (
    <>
      <div>
        <label className="block text-xs mb-1.5" style={labelStyle}>What your venue provides</label>
        <div className="flex flex-wrap gap-2">
          {EQUIPMENT_OPTIONS.map((opt) => {
            const on = provided.includes(opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggle(opt.key)}
                aria-pressed={on}
                className="text-xs px-3 py-1.5 rounded-full transition-all"
                style={{
                  backgroundColor: on ? "rgba(212,166,79,0.15)" : "#1e2128",
                  color: on ? "#D4A64F" : "#9a9591",
                  border: `1px solid ${on ? "rgba(212,166,79,0.4)" : "rgba(255,255,255,0.07)"}`,
                }}
              >
                {on ? "✓ " : ""}{opt.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className="block text-xs mb-1.5" style={labelStyle}>What artists should bring</label>
        <textarea
          rows={2}
          value={artistShouldBring}
          onChange={(e) => onArtistShouldBringChange(e.target.value)}
          placeholder="Own instruments, guitar cables, in-ear monitors…"
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
          style={inputStyle}
        />
      </div>
      <div>
        <label className="block text-xs mb-1.5" style={labelStyle}>Other stage notes</label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Stage size, load-in details, anything else…"
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
          style={inputStyle}
        />
      </div>
    </>
  );
}
