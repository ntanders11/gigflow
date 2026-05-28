"use client";

import { Droppable } from "@hello-pangea/dnd";
import { Venue, VenueStage, STAGES, OutreachInfo } from "@/types";
import VenueCard from "@/components/venue/VenueCard";

interface Props {
  stage: VenueStage;
  venues: Venue[];
  onReply: (venue: Venue) => void;
  onEmail: (venue: Venue) => void;
  outreachMap: Record<string, OutreachInfo>;
  batchMode: "pitch" | "followup" | null;
  selectedVenueIds: Set<string>;
  onBatchStart: (mode: "pitch" | "followup") => void;
  onToggleSelect: (venueId: string) => void;
  onSelectAll: (venueIds: string[]) => void;
  onBatchSend: () => void;
  onBatchCancel: () => void;
}

export default function KanbanColumn({
  stage, venues, onReply, onEmail, outreachMap,
  batchMode, selectedVenueIds,
  onBatchStart, onToggleSelect, onSelectAll, onBatchSend, onBatchCancel,
}: Props) {
  const label = STAGES.find((s) => s.key === stage)?.label ?? stage;

  // Which batch mode applies to this column
  const columnBatchMode: "pitch" | "followup" | null =
    stage === "discovered" ? "pitch" : stage === "contacted" ? "followup" : null;
  const isActiveBatch = batchMode !== null && batchMode === columnBatchMode;
  const isOtherBatch = batchMode !== null && !isActiveBatch;

  function isBatchDisabled(venue: Venue): boolean {
    if (!venue.contact_email?.trim()) return true;
    if (batchMode === "followup" && outreachMap[venue.id]?.hasFollowUp) return true;
    return false;
  }

  const eligibleIds = venues.filter((v) => !isBatchDisabled(v)).map((v) => v.id);
  const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selectedVenueIds.has(id));
  const selectedCount = venues.filter((v) => selectedVenueIds.has(v.id)).length;

  return (
    <div className="flex flex-col flex-1 min-w-36" style={{ opacity: isOtherBatch ? 0.4 : 1, transition: "opacity 0.2s" }}>
      {/* Column header — mobile only */}
      <div className="md:hidden flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9a9591" }}>
          {label}
        </span>
        <span className="text-xs rounded-full px-2 py-0.5 font-medium" style={{ backgroundColor: "#262b33", color: "#d4a853" }}>
          {venues.length}
        </span>
      </div>

      {/* Batch trigger button — only for discovered and contacted, only when no batch active */}
      {columnBatchMode && !batchMode && venues.length > 0 && (
        <button
          onClick={() => onBatchStart(columnBatchMode)}
          className="mb-2 w-full text-xs px-2 py-1.5 rounded-lg font-medium transition-all hover:brightness-110"
          style={
            columnBatchMode === "pitch"
              ? { backgroundColor: "rgba(212,168,83,0.12)", color: "#d4a853", border: "1px solid rgba(212,168,83,0.25)" }
              : { backgroundColor: "rgba(155,127,232,0.12)", color: "#9b7fe8", border: "1px solid rgba(155,127,232,0.25)" }
          }
        >
          {columnBatchMode === "pitch" ? "✉ Send Batch Pitch" : "↩ Send Follow-up"}
        </button>
      )}

      {/* Select All / Cancel bar — only when this column is active */}
      {isActiveBatch && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            onClick={() => allSelected ? onSelectAll([]) : onSelectAll(eligibleIds)}
            className="text-xs px-2 py-1 rounded font-medium"
            style={{ color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)", background: "#1e2128" }}
          >
            {allSelected ? "Deselect All" : "Select All"}
          </button>
          <button
            onClick={onBatchCancel}
            className="text-xs"
            style={{ color: "#5e5c58" }}
          >
            Cancel
          </button>
        </div>
      )}

      <Droppable droppableId={stage} isDropDisabled={!!batchMode}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="flex-1 space-y-2 min-h-[200px] rounded-lg p-1 transition-colors"
            style={{ backgroundColor: snapshot.isDraggingOver ? "#1e2128" : "transparent" }}
          >
            {venues.map((venue, index) => (
              <VenueCard
                key={venue.id}
                venue={venue}
                index={index}
                onReply={onReply}
                onEmail={onEmail}
                outreach={outreachMap[venue.id] ?? null}
                batchActive={isActiveBatch}
                batchSelected={selectedVenueIds.has(venue.id)}
                batchDisabled={isBatchDisabled(venue)}
                onBatchToggle={() => onToggleSelect(venue.id)}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {/* Floating action bar — fixed to viewport bottom when this column has selections */}
      {isActiveBatch && selectedCount > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-4 px-4 py-3"
          style={{ backgroundColor: "#16181c", borderTop: "1px solid rgba(255,255,255,0.1)" }}
        >
          <span className="text-sm" style={{ color: "#9a9591" }}>
            {selectedCount} venue{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={onBatchSend}
            className="text-sm px-4 py-2 rounded-lg font-semibold transition-all hover:brightness-110"
            style={
              batchMode === "pitch"
                ? { backgroundColor: "#d4a853", color: "#0e0f11" }
                : { backgroundColor: "#9b7fe8", color: "#0e0f11" }
            }
          >
            {batchMode === "pitch"
              ? `Send Pitch to ${selectedCount} →`
              : `Send Follow-up to ${selectedCount} →`}
          </button>
        </div>
      )}
    </div>
  );
}
