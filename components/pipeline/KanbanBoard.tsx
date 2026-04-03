"use client";

import Link from "next/link";
import { DragDropContext, DropResult } from "@hello-pangea/dnd";
import { Venue, VenueStage, STAGES } from "@/types";
import KanbanColumn from "./KanbanColumn";

interface Props {
  venues: Venue[];
  setVenues: React.Dispatch<React.SetStateAction<Venue[]>>;
}

export default function KanbanBoard({ venues, setVenues }: Props) {
  function getVenuesByStage(stage: VenueStage) {
    return venues.filter((v) => v.stage === stage);
  }

  async function onDragEnd(result: DropResult) {
    const { draggableId, destination } = result;
    if (!destination) return;

    const newStage = destination.droppableId as VenueStage;
    const venue = venues.find((v) => v.id === draggableId);
    if (!venue || venue.stage === newStage) return;

    // Optimistic update
    setVenues((prev) =>
      prev.map((v) => (v.id === draggableId ? { ...v, stage: newStage } : v))
    );

    // Persist to DB
    const res = await fetch(`/api/venues/${draggableId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: newStage }),
    });

    // Roll back on failure
    if (!res.ok) {
      setVenues((prev) =>
        prev.map((v) =>
          v.id === draggableId ? { ...v, stage: venue.stage } : v
        )
      );
    }
  }

  if (venues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="text-sm" style={{ color: "#5e5c58" }}>
          No venues yet.
        </p>
        <Link
          href="/venues/import"
          className="mt-3 text-sm font-medium underline"
          style={{ color: "#d4a853" }}
        >
          Import your venues CSV to get started
        </Link>
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-3 pb-4">
        {STAGES.map(({ key }) => (
          <KanbanColumn
            key={key}
            stage={key}
            venues={getVenuesByStage(key)}
          />
        ))}
      </div>
    </DragDropContext>
  );
}
