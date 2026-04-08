"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Venue, VenueStage, STAGES } from "@/types";
import AddVenueModal from "@/components/venue/AddVenueModal";

const KanbanBoard = dynamic(() => import("./KanbanBoard"), { ssr: false });

interface Props {
  initialVenues: Venue[];
  initialStageFilter: VenueStage | null;
}

export default function PipelineView({ initialVenues, initialStageFilter }: Props) {
  const [venues, setVenues] = useState<Venue[]>(initialVenues);
  const [query, setQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const router = useRouter();

  const filtered = venues.filter((v) => {
    const matchesStage = initialStageFilter ? v.stage === initialStageFilter : true;
    const matchesQuery = query.trim()
      ? [v.name, v.city, v.type, v.contact_name]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(query.toLowerCase()))
      : true;
    return matchesStage && matchesQuery;
  });

  const stageCounts = STAGES.reduce(
    (acc, { key }) => {
      acc[key] = filtered.filter((v) => v.stage === key).length;
      return acc;
    },
    {} as Record<VenueStage, number>
  );

  return (
    <div>
      {showAddModal && (
        <AddVenueModal
          onClose={() => setShowAddModal(false)}
          onAdded={(venue) => {
            setVenues((prev) => [venue, ...prev]);
            setShowAddModal(false);
          }}
        />
      )}
      {/* Header — sticky on desktop, static on mobile */}
      <div
        className="md:sticky top-0 z-10 shadow-sm px-4 md:px-8 pt-6 md:pt-8 pb-0"
        style={{
          backgroundColor: "#16181c",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "#f0ede8" }}>
              Pipeline
            </h1>
            <p className="text-sm mt-1" style={{ color: "#9a9591" }}>
              {filtered.length} venues
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="text-sm px-3 py-1.5 rounded-lg w-32 md:w-52 focus:outline-none"
              style={{
                background: "#262b33",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#f0ede8",
              }}
            />
            <button
              onClick={() => setShowAddModal(true)}
              className="text-sm px-3 py-1.5 rounded-lg font-semibold shrink-0 transition-all hover:brightness-110"
              style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
            >
              + Add
            </button>
          </div>
        </div>
        {/* Stage labels — hidden on mobile, they're on each column header instead */}
        <div className="hidden md:flex gap-3">
          {STAGES.map(({ key, label }) => (
            <div
              key={key}
              className="flex-1 min-w-36 flex items-center justify-between pb-3"
            >
              <h2 className="text-sm font-semibold" style={{ color: "#f0ede8" }}>
                {label}
              </h2>
              <span
                className="text-xs rounded-full px-2 py-0.5 font-medium"
                style={{
                  backgroundColor: "#262b33",
                  color: "#d4a853",
                }}
              >
                {stageCounts[key]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Stage filter banner */}
      {initialStageFilter && (
        <div className="px-8 pt-4">
          <div
            className="flex items-center justify-between rounded-lg px-4 py-2 text-sm"
            style={{ backgroundColor: "rgba(155,127,232,0.1)", border: "1px solid rgba(155,127,232,0.3)" }}
          >
            <span style={{ color: "#9b7fe8" }}>
              Showing <strong>{STAGES.find(s => s.key === initialStageFilter)?.label}</strong> venues only
            </span>
            <button
              onClick={() => router.push("/pipeline")}
              className="text-xs underline"
              style={{ color: "#9b7fe8" }}
            >
              Clear filter
            </button>
          </div>
        </div>
      )}

      {/* Board */}
      <div className="px-4 md:px-8 pt-4 pb-8 overflow-x-auto">
        <KanbanBoard venues={filtered} setVenues={setVenues} />
      </div>
    </div>
  );
}
