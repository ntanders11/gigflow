"use client";

import { Droppable } from "@hello-pangea/dnd";
import { Venue, VenueStage } from "@/types";
import VenueCard from "@/components/venue/VenueCard";

interface Props {
  stage: VenueStage;
  venues: Venue[];
}

export default function KanbanColumn({ stage, venues }: Props) {
  return (
    <div className="flex flex-col w-60 shrink-0">
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
              <VenueCard key={venue.id} venue={venue} index={index} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
