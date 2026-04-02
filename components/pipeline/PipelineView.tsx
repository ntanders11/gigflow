"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Venue, VenueStage, STAGES } from "@/types";

const KanbanBoard = dynamic(() => import("./KanbanBoard"), { ssr: false });

interface Props {
  initialVenues: Venue[];
}

export default function PipelineView({ initialVenues }: Props) {
  const [venues, setVenues] = useState<Venue[]>(initialVenues);

  const stageCounts = STAGES.reduce(
    (acc, { key }) => {
      acc[key] = venues.filter((v) => v.stage === key).length;
      return acc;
    },
    {} as Record<VenueStage, number>
  );

  return (
    <div>
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 shadow-sm px-8 pt-8 pb-0"
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
              {venues.length} venues · drag cards to update stage
            </p>
          </div>
        </div>
        <div className="flex gap-5">
          {STAGES.map(({ key, label }) => (
            <div
              key={key}
              className="w-60 shrink-0 flex items-center justify-between pb-3"
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

      {/* Board */}
      <div className="px-8 pt-4 pb-8">
        <KanbanBoard venues={venues} setVenues={setVenues} />
      </div>
    </div>
  );
}
