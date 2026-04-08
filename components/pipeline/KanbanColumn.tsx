"use client";

import { Droppable } from "@hello-pangea/dnd";
import { Venue, VenueStage, STAGES } from "@/types";
import VenueCard from "@/components/venue/VenueCard";

interface Props {
  stage: VenueStage;
  venues: Venue[];
  onReply: (venueId: string) => void;
  outreachMap: Record<string, { count: number; lastDate: string | null }>;
}

export default function KanbanColumn({ stage, venues, onReply, outreachMap }: Props) {
  const label = STAGES.find((s) => s.key === stage)?.label ?? stage;

  return (
    <div className="flex flex-col flex-1 min-w-36">
      {/* Column header — visible on mobile only (desktop shows them in sticky bar) */}
      <div className="md:hidden flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9a9591" }}>
          {label}
        </span>
        <span className="text-xs rounded-full px-2 py-0.5 font-medium" style={{ backgroundColor: "#262b33", color: "#d4a853" }}>
          {venues.length}
        </span>
      </div>
      <Droppable droppableId={stage}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="flex-1 space-y-2 min-h-[200px] rounded-lg p-1 transition-colors"
            style={{
              backgroundColor: snapshot.isDraggingOver
                ? "#1e2128"
                : "transparent",
            }}
          >
            {venues.map((venue, index) => (
              <VenueCard key={venue.id} venue={venue} index={index} onReply={onReply} outreach={outreachMap[venue.id] ?? null} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
