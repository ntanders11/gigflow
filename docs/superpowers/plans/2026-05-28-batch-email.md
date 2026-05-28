# Batch Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Send Batch Pitch" and "Send Follow-up" buttons to the Pipeline Kanban board so artists can email groups of venues at once.

**Architecture:** Batch state (mode + selection) lives in `PipelineView` and is threaded down through `KanbanBoard` → `KanbanColumn` → `VenueCard`. A new `BatchEmailModal` handles the confirm/progress/results flow and calls the existing `/api/send-email` endpoint for each venue sequentially. Email template functions are extracted to a shared `lib/email-templates.ts` used by both the existing `PitchEmailModal` and the new `BatchEmailModal`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase, Resend, @hello-pangea/dnd, Tailwind CSS (inline styles for dark theme)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/012_interactions_followup_type.sql` | Create | Allow "follow_up" as interaction type in DB |
| `types/index.ts` | Modify | Add "follow_up" to InteractionType; expand outreachMap value type |
| `lib/email-templates.ts` | Create | Shared email build functions (extracted from PitchEmailModal) |
| `components/venue/PitchEmailModal.tsx` | Modify | Import template functions from lib/email-templates.ts |
| `app/api/send-email/route.ts` | Modify | Accept optional interaction_type field |
| `app/(protected)/pipeline/page.tsx` | Modify | Add hasFollowUp to outreachMap |
| `components/pipeline/PipelineView.tsx` | Modify | Add batch state, open BatchEmailModal, handle completion |
| `components/pipeline/KanbanBoard.tsx` | Modify | Thread batch props to KanbanColumn |
| `components/pipeline/KanbanColumn.tsx` | Modify | Batch button, Select All, floating action bar, isDragDisabled |
| `components/venue/VenueCard.tsx` | Modify | Checkbox overlay in batch mode, isDragDisabled |
| `components/pipeline/BatchEmailModal.tsx` | Create | Confirm + preview + progress + results modal |

---

## Task 1: DB migration and type foundation

**Files:**
- Create: `supabase/migrations/012_interactions_followup_type.sql`
- Modify: `types/index.ts`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/012_interactions_followup_type.sql
-- Add "follow_up" as an allowed interaction type.
-- The interactions.type column is plain TEXT with no check constraint,
-- so this migration is a no-op on the DB side — it documents the new
-- value and serves as a record for schema history.
-- Run this in the Supabase SQL Editor: it will execute successfully.
DO $$ BEGIN
  -- No-op: column is unconstrained TEXT. New value "follow_up" is valid.
  RAISE NOTICE 'interactions.type now accepts follow_up';
END $$;
```

- [ ] **Step 2: Add "follow_up" to InteractionType in `types/index.ts`**

Find this line (line 11):
```typescript
export type InteractionType = "email" | "call" | "in_person" | "note" | "reply";
```
Replace with:
```typescript
export type InteractionType = "email" | "call" | "in_person" | "note" | "reply" | "follow_up";
```

- [ ] **Step 3: Expand the outreachMap value type in `types/index.ts`**

Add a new exported type after the InteractionType line:
```typescript
export interface OutreachInfo {
  count: number;
  lastDate: string | null;
  hasFollowUp: boolean;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/tayloranderson/gigflow && npx tsc --noEmit
```
Expected: no errors (existing code uses `{ count, lastDate }` shape — it will get type errors in the next tasks when we update callers, but at this point only the type definition is changing).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/012_interactions_followup_type.sql types/index.ts
git commit -m "feat: add follow_up interaction type and OutreachInfo type"
```

---

## Task 2: Extract shared email templates

**Files:**
- Create: `lib/email-templates.ts`
- Modify: `components/venue/PitchEmailModal.tsx`

- [ ] **Step 1: Create `lib/email-templates.ts`**

Copy the four build functions out of `PitchEmailModal.tsx` (lines 6–64) into a new file:

```typescript
// lib/email-templates.ts
import { ArtistProfile } from "@/types";

export function buildSubject(venueName: string): string {
  return `Live music inquiry for ${venueName} — full-band sound, one performer`;
}

export function buildFollowUpSubject(venueName: string): string {
  return `Following up — live music inquiry for ${venueName}`;
}

export function buildBody(
  venueName: string,
  profile: ArtistProfile | null,
  contactName?: string | null
): string {
  const greeting = contactName ? `Hi ${contactName},` : `Hi there,`;
  const name = profile?.display_name ?? "Taylor Anderson";
  const phone = profile?.phone ?? "(503) 997-3586";
  const website = profile?.social_links?.website ?? "taylorandersonmusic.com";
  const youtube =
    profile?.social_links?.youtube ??
    profile?.video_samples?.[0]?.url ??
    "https://youtu.be/JaPOuz1R0HI?si=lo5JhEbgowL2g5JU";
  const bio = profile?.bio?.trim()
    ? profile.bio.trim()
    : `For over a decade, I ran my own music business — booking and performing at resorts, wineries, and venues throughout the Scottsdale and Phoenix area. What makes my show unique: using a live looper, I build guitar, bass, keys, and drums on the spot — a full-band sound with just one performer. My sets blend Top 40, '60s–'00s classics, and a touch of country.`;

  return `${greeting}

I'm ${name} — a full-time musician with over a decade of live performance experience. I recently relocated to the Newberg area and would love to play at ${venueName}.

${bio}

Hear it for yourself: ${youtube}

I'm booking upcoming dates now and would love to find a time that works for ${venueName}. Would you be open to a quick call this week?

Thanks so much,
${name}
${phone}
${website}`;
}

export function buildFollowUpBody(
  venueName: string,
  profile: ArtistProfile | null,
  contactName?: string | null
): string {
  const greeting = contactName ? `Hi ${contactName},` : `Hi there,`;
  const name = profile?.display_name ?? "Taylor Anderson";
  const phone = profile?.phone ?? "(503) 997-3586";
  const website = profile?.social_links?.website ?? "taylorandersonmusic.com";
  const youtube =
    profile?.social_links?.youtube ??
    profile?.video_samples?.[0]?.url ??
    "https://youtu.be/JaPOuz1R0HI?si=lo5JhEbgowL2g5JU";

  return `${greeting}

I wanted to follow up on my email from last week about playing at ${venueName}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.

Hear it for yourself: ${youtube}

Happy to work around your schedule. Thanks for your time!

${name}
${phone}
${website}`;
}
```

- [ ] **Step 2: Update `PitchEmailModal.tsx` to import from the shared file**

At the top of `components/venue/PitchEmailModal.tsx`, replace the four function definitions (lines 6–64) with imports:

```typescript
import { buildSubject, buildFollowUpSubject, buildBody, buildFollowUpBody } from "@/lib/email-templates";
```

Remove the local `buildSubject`, `buildFollowUpSubject`, `buildBody`, and `buildFollowUpBody` function definitions (they are now in `lib/email-templates.ts`).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/email-templates.ts components/venue/PitchEmailModal.tsx
git commit -m "refactor: extract email template functions to lib/email-templates.ts"
```

---

## Task 3: Update send-email API to support follow_up interaction type

**Files:**
- Modify: `app/api/send-email/route.ts`

- [ ] **Step 1: Accept optional `interaction_type` in the request body**

In `app/api/send-email/route.ts`, find the destructuring line (line 21):
```typescript
const { to, subject, body: emailBody, venue_id, user_id } = body;
```
Replace with:
```typescript
const { to, subject, body: emailBody, venue_id, user_id, interaction_type } = body;
```

- [ ] **Step 2: Use `interaction_type` when logging the interaction**

Find the interaction insert block (around line 73) where `type: "email"` is hardcoded:
```typescript
      type: "email",
```
Replace with:
```typescript
      type: (interaction_type === "follow_up" ? "follow_up" : "email") as import("@/types").InteractionType,
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/send-email/route.ts
git commit -m "feat: send-email API accepts optional interaction_type for follow-up logging"
```

---

## Task 4: Update pipeline page to populate hasFollowUp in outreachMap

**Files:**
- Modify: `app/(protected)/pipeline/page.tsx`
- Modify: `components/pipeline/PipelineView.tsx` (prop type only)
- Modify: `components/pipeline/KanbanBoard.tsx` (prop type only)
- Modify: `components/pipeline/KanbanColumn.tsx` (prop type only)
- Modify: `components/venue/VenueCard.tsx` (prop type only)

- [ ] **Step 1: Update `pipeline/page.tsx` to build `hasFollowUp`**

Replace the outreachMap build loop in `app/(protected)/pipeline/page.tsx`:

```typescript
  // Build a map: venue_id → { count, lastDate, hasFollowUp }
  const outreachMap: Record<string, { count: number; lastDate: string | null; hasFollowUp: boolean }> = {};
  for (const i of interactions ?? []) {
    if (!outreachMap[i.venue_id]) outreachMap[i.venue_id] = { count: 0, lastDate: null, hasFollowUp: false };
    outreachMap[i.venue_id].count++;
    if (!outreachMap[i.venue_id].lastDate || i.occurred_at > outreachMap[i.venue_id].lastDate!) {
      outreachMap[i.venue_id].lastDate = i.occurred_at;
    }
    if (i.type === "follow_up") {
      outreachMap[i.venue_id].hasFollowUp = true;
    }
  }
```

- [ ] **Step 2: Update prop types in `PipelineView.tsx`**

Import `OutreachInfo` from `@/types`:
```typescript
import { Venue, VenueStage, STAGES, OutreachInfo } from "@/types";
```

Change the `outreachMap` prop type in the `Props` interface:
```typescript
  outreachMap: Record<string, OutreachInfo>;
```

- [ ] **Step 3: Update prop types in `KanbanBoard.tsx`**

Import `OutreachInfo`:
```typescript
import { Venue, VenueStage, STAGES, OutreachInfo } from "@/types";
```

Change the `outreachMap` prop type in `Props`:
```typescript
  outreachMap: Record<string, OutreachInfo>;
```

- [ ] **Step 4: Update prop types in `KanbanColumn.tsx`**

Import `OutreachInfo`:
```typescript
import { Venue, VenueStage, STAGES, OutreachInfo } from "@/types";
```

Change the `outreachMap` prop type in `Props`:
```typescript
  outreachMap: Record<string, OutreachInfo>;
```

- [ ] **Step 5: Update prop type in `VenueCard.tsx`**

Import `OutreachInfo`:
```typescript
import { Venue, OutreachInfo } from "@/types";
```

Change the `outreach` prop type in `Props`:
```typescript
  outreach: OutreachInfo | null;
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/(protected)/pipeline/page.tsx components/pipeline/PipelineView.tsx components/pipeline/KanbanBoard.tsx components/pipeline/KanbanColumn.tsx components/venue/VenueCard.tsx
git commit -m "feat: add hasFollowUp to outreachMap for follow-up detection"
```

---

## Task 5: Add batch state to PipelineView and thread through KanbanBoard

**Files:**
- Modify: `components/pipeline/PipelineView.tsx`
- Modify: `components/pipeline/KanbanBoard.tsx`

- [ ] **Step 1: Add batch state and types to `PipelineView.tsx`**

Add these imports at the top:
```typescript
import { Venue, VenueStage, STAGES, OutreachInfo } from "@/types";
```
(Replace the existing `@/types` import.)

Add this type near the top of the file, after imports:
```typescript
type BatchMode = "pitch" | "followup" | null;
```

Add these state variables inside `PipelineView` after the existing `useState` declarations:
```typescript
  const [batchMode, setBatchMode] = useState<BatchMode>(null);
  const [selectedVenueIds, setSelectedVenueIds] = useState<Set<string>>(new Set());
  const [batchModalOpen, setBatchModalOpen] = useState(false);
```

Add these batch handler functions inside `PipelineView` (before the `return`):
```typescript
  function startBatch(mode: "pitch" | "followup") {
    setBatchMode(mode);
    setSelectedVenueIds(new Set());
  }

  function cancelBatch() {
    setBatchMode(null);
    setSelectedVenueIds(new Set());
  }

  function toggleVenueSelect(venueId: string) {
    setSelectedVenueIds((prev) => {
      const next = new Set(prev);
      if (next.has(venueId)) next.delete(venueId);
      else next.add(venueId);
      return next;
    });
  }

  function selectAllForBatch(venueIds: string[]) {
    setSelectedVenueIds(new Set(venueIds));
  }

  function openBatchModal() {
    if (selectedVenueIds.size === 0) return;
    setBatchModalOpen(true);
  }
```

- [ ] **Step 2: Pass batch props to `KanbanBoard` in `PipelineView.tsx`**

Find the `<KanbanBoard ...>` JSX in `PipelineView.tsx` and add the new props:
```tsx
        <KanbanBoard
          venues={filtered}
          setVenues={setVenues}
          outreachMap={outreachMap}
          onEmail={setEmailVenue}
          batchMode={batchMode}
          selectedVenueIds={selectedVenueIds}
          onBatchStart={startBatch}
          onToggleSelect={toggleVenueSelect}
          onSelectAll={selectAllForBatch}
          onBatchSend={openBatchModal}
          onBatchCancel={cancelBatch}
        />
```

- [ ] **Step 3: Update `KanbanBoard.tsx` Props interface and forward batch props to `KanbanColumn`**

Replace the `Props` interface in `KanbanBoard.tsx`:
```typescript
interface Props {
  venues: Venue[];
  setVenues: React.Dispatch<React.SetStateAction<Venue[]>>;
  outreachMap: Record<string, OutreachInfo>;
  onEmail: (venue: Venue) => void;
  batchMode: "pitch" | "followup" | null;
  selectedVenueIds: Set<string>;
  onBatchStart: (mode: "pitch" | "followup") => void;
  onToggleSelect: (venueId: string) => void;
  onSelectAll: (venueIds: string[]) => void;
  onBatchSend: () => void;
  onBatchCancel: () => void;
}
```

Update the function signature to destructure new props:
```typescript
export default function KanbanBoard({ venues, setVenues, outreachMap, onEmail, batchMode, selectedVenueIds, onBatchStart, onToggleSelect, onSelectAll, onBatchSend, onBatchCancel }: Props) {
```

Update the `<KanbanColumn>` render in `KanbanBoard.tsx` to pass batch props:
```tsx
            <KanbanColumn
              key={key}
              stage={key}
              venues={getVenuesByStage(key)}
              onReply={onReply}
              onEmail={onEmail}
              outreachMap={outreachMap}
              batchMode={batchMode}
              selectedVenueIds={selectedVenueIds}
              onBatchStart={onBatchStart}
              onToggleSelect={onToggleSelect}
              onSelectAll={onSelectAll}
              onBatchSend={onBatchSend}
              onBatchCancel={onBatchCancel}
            />
```
Note: `onReply` must be included — it was in the original and KanbanColumn still needs it.
```

Add the `OutreachInfo` import to `KanbanBoard.tsx`:
```typescript
import { Venue, VenueStage, STAGES, OutreachInfo } from "@/types";
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: errors about `KanbanColumn` not accepting the new props yet — that's fine, we fix it in Task 6.

- [ ] **Step 5: Commit**

```bash
git add components/pipeline/PipelineView.tsx components/pipeline/KanbanBoard.tsx
git commit -m "feat: add batch state to PipelineView and thread props through KanbanBoard"
```

---

## Task 6: Update KanbanColumn with batch UI

**Files:**
- Modify: `components/pipeline/KanbanColumn.tsx`

Replace the entire file with the following:

- [ ] **Step 1: Rewrite `KanbanColumn.tsx`**

```typescript
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

  // Which batch mode is relevant for this column
  const columnBatchMode = stage === "discovered" ? "pitch" : stage === "contacted" ? "followup" : null;
  const isActiveBatch = batchMode === columnBatchMode && columnBatchMode !== null;
  const isOtherBatch = batchMode !== null && !isActiveBatch;

  // For follow-up: skip venues that already received one
  function isBatchDisabled(venue: Venue): boolean {
    if (!venue.contact_email?.trim()) return true;
    if (batchMode === "followup" && outreachMap[venue.id]?.hasFollowUp) return true;
    return false;
  }

  // Eligible venue IDs for select-all in this column
  const eligibleIds = venues.filter((v) => !isBatchDisabled(v)).map((v) => v.id);
  const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selectedVenueIds.has(id));
  const selectedCount = venues.filter((v) => selectedVenueIds.has(v.id)).length;

  return (
    <div className="flex flex-col flex-1 min-w-36" style={{ opacity: isOtherBatch ? 0.4 : 1 }}>
      {/* Column header — mobile only */}
      <div className="md:hidden flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9a9591" }}>
          {label}
        </span>
        <span className="text-xs rounded-full px-2 py-0.5 font-medium" style={{ backgroundColor: "#262b33", color: "#d4a853" }}>
          {venues.length}
        </span>
      </div>

      {/* Batch action button — only for discovered and contacted columns */}
      {columnBatchMode && !batchMode && (
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

      {/* Select All / Cancel bar — shown when this column is in active batch mode */}
      {isActiveBatch && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            onClick={() => allSelected ? onSelectAll([]) : onSelectAll(eligibleIds)}
            className="text-xs px-2 py-1 rounded font-medium transition-all"
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

      <Droppable droppableId={stage} isDropDisabled={isActiveBatch || isOtherBatch}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="flex-1 space-y-2 min-h-[200px] rounded-lg p-1 transition-colors"
            style={{
              backgroundColor: snapshot.isDraggingOver ? "#1e2128" : "transparent",
            }}
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

      {/* Floating action bar — fixed to viewport bottom when this column is active */}
      {isActiveBatch && selectedCount > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-3 px-4 py-3"
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
            {batchMode === "pitch" ? `Send Pitch to ${selectedCount}` : `Send Follow-up to ${selectedCount}`} →
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: errors about `VenueCard` not accepting new props yet — fix in Task 7.

- [ ] **Step 3: Commit**

```bash
git add components/pipeline/KanbanColumn.tsx
git commit -m "feat: KanbanColumn batch mode — select UI, action bar, batch buttons"
```

---

## Task 7: Update VenueCard for batch mode

**Files:**
- Modify: `components/venue/VenueCard.tsx`

- [ ] **Step 1: Add batch props to VenueCard**

Replace the `Props` interface:
```typescript
interface Props {
  venue: Venue;
  index: number;
  onReply: (venue: Venue) => void;
  onEmail: (venue: Venue) => void;
  outreach: OutreachInfo | null;
  batchActive?: boolean;
  batchSelected?: boolean;
  batchDisabled?: boolean;
  onBatchToggle?: () => void;
}
```

Update the function signature:
```typescript
export default function VenueCard({ venue, index, onReply, onEmail, outreach, batchActive, batchSelected, batchDisabled, onBatchToggle }: Props) {
```

- [ ] **Step 2: Update the `Draggable` wrapper to disable drag in batch mode**

Find the `<Draggable>` opening tag:
```tsx
    <Draggable draggableId={venue.id} index={index}>
```
Replace with:
```tsx
    <Draggable draggableId={venue.id} index={index} isDragDisabled={!!batchActive}>
```

- [ ] **Step 3: Add checkbox overlay and batch-click behavior**

In the card's outer `<div>` (the one with `ref={provided.innerRef}`), add an `onClick` handler for batch toggle and a visual checkbox:

Replace the opening of the inner card `<div>` (the one with `backgroundColor: "#16181c"`) to add the click handler:
```tsx
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="rounded-lg p-3 select-none transition-shadow relative"
          onClick={batchActive && !batchDisabled ? onBatchToggle : undefined}
          style={{
            ...provided.draggableProps.style,
            backgroundColor: batchSelected ? "rgba(212,168,83,0.1)" : "#16181c",
            border: batchSelected
              ? "1px solid rgba(212,168,83,0.4)"
              : snapshot.isDragging
              ? "1px solid rgba(255,255,255,0.12)"
              : "1px solid rgba(255,255,255,0.07)",
            boxShadow: snapshot.isDragging ? "0 8px 24px rgba(0,0,0,0.4)" : "none",
            opacity: batchDisabled ? 0.4 : 1,
            cursor: batchActive ? (batchDisabled ? "not-allowed" : "pointer") : "grab",
          }}
        >
```

Add the checkbox indicator right after the opening div (before the `<Link>`):
```tsx
          {batchActive && (
            <div
              className="absolute top-2 right-2 w-4 h-4 rounded flex items-center justify-center"
              style={{
                backgroundColor: batchSelected ? "#d4a853" : "transparent",
                border: `1px solid ${batchSelected ? "#d4a853" : "rgba(255,255,255,0.2)"}`,
              }}
            >
              {batchSelected && <span style={{ color: "#0e0f11", fontSize: "10px", fontWeight: 700 }}>✓</span>}
            </div>
          )}
```

Also update the `cursor` on the `<Link>` to avoid conflicting pointer styles in batch mode:
```tsx
          <Link href={`/venues/${venue.id}`} onClick={(e) => { e.stopPropagation(); if (batchActive) e.preventDefault(); }}>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Quick smoke test in browser**

Run `npm run dev`, open `http://localhost:3000/pipeline`. Click "Send Batch Pitch" in the Discovered column — you should see checkboxes appear on cards, a Select All toggle, and the ability to select/deselect. The floating bar should appear when venues are selected. No emails are sent yet (modal not built).

- [ ] **Step 6: Commit**

```bash
git add components/venue/VenueCard.tsx
git commit -m "feat: VenueCard batch mode — checkbox overlay, isDragDisabled"
```

---

## Task 8: Build BatchEmailModal

**Files:**
- Create: `components/pipeline/BatchEmailModal.tsx`

- [ ] **Step 1: Create `components/pipeline/BatchEmailModal.tsx`**

```typescript
"use client";

import { useState, useEffect } from "react";
import { Venue, ArtistProfile, Interaction } from "@/types";
import { buildSubject, buildFollowUpSubject, buildBody, buildFollowUpBody } from "@/lib/email-templates";

export interface SendResult {
  venueId: string;
  venueName: string;
  success: boolean;
  error?: string;
}

interface Props {
  venues: Venue[];        // only the selected, eligible venues
  mode: "pitch" | "followup";
  onClose: () => void;
  onComplete: (results: SendResult[], sentVenueIds: string[]) => void;
}

export default function BatchEmailModal({ venues, mode, onClose, onComplete }: Props) {
  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [step, setStep] = useState<"confirm" | "sending" | "results">("confirm");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<SendResult[]>([]);

  const previewVenue = venues[0];

  const previewSubject = previewVenue
    ? mode === "pitch"
      ? buildSubject(previewVenue.name)
      : buildFollowUpSubject(previewVenue.name)
    : "";

  const previewBody = previewVenue
    ? mode === "pitch"
      ? buildBody(previewVenue.name, profile, previewVenue.contact_name)
      : buildFollowUpBody(previewVenue.name, profile, previewVenue.contact_name)
    : "";

  useEffect(() => {
    fetch("/api/artist-profile")
      .then((r) => r.json())
      .then((p: ArtistProfile) => setProfile(p))
      .catch(() => {/* use null profile fallback */});
  }, []);

  async function handleSend() {
    setStep("sending");
    const sendResults: SendResult[] = [];

    for (let i = 0; i < venues.length; i++) {
      const venue = venues[i];
      setProgress(i);

      try {
        const subject = mode === "pitch"
          ? buildSubject(venue.name)
          : buildFollowUpSubject(venue.name);
        const body = mode === "pitch"
          ? buildBody(venue.name, profile, venue.contact_name)
          : buildFollowUpBody(venue.name, profile, venue.contact_name);

        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: venue.contact_email!,
            subject,
            body,
            venue_id: venue.id,
            user_id: venue.user_id,
            interaction_type: mode === "followup" ? "follow_up" : "email",
          }),
        });

        const data = await res.json();
        sendResults.push({
          venueId: venue.id,
          venueName: venue.name,
          success: res.ok,
          error: res.ok ? undefined : (data.error ?? "Unknown error"),
        });
      } catch (err) {
        sendResults.push({
          venueId: venue.id,
          venueName: venue.name,
          success: false,
          error: "Network error",
        });
      }

      // Small delay to avoid Resend rate limits
      if (i < venues.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    setProgress(venues.length);
    setResults(sendResults);
    setStep("results");
  }

  const sentVenueIds = results.filter((r) => r.success).map((r) => r.venueId);
  const successCount = sentVenueIds.length;
  const failCount = results.length - successCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-lg rounded-xl flex flex-col max-h-[90vh]"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <h2 className="text-base font-semibold" style={{ color: "#f0ede8" }}>
            {mode === "pitch" ? "Send Batch Pitch" : "Send Follow-up"} — {venues.length} venue{venues.length !== 1 ? "s" : ""}
          </h2>
          {step !== "sending" && (
            <button onClick={onClose} style={{ color: "#9a9591", fontSize: "1.25rem", lineHeight: 1 }}>×</button>
          )}
        </div>

        {/* Confirm step */}
        {step === "confirm" && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <p className="text-sm" style={{ color: "#9a9591" }}>
                {mode === "pitch"
                  ? `Sending a personalized pitch email to ${venues.length} discovered venue${venues.length !== 1 ? "s" : ""}. Each email uses your artist profile.`
                  : `Sending a follow-up email to ${venues.length} contacted venue${venues.length !== 1 ? "s" : ""}.`}
              </p>

              {/* Venue list */}
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {venues.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded" style={{ backgroundColor: "#1e2128", color: "#f0ede8" }}>
                    <span>{v.name}</span>
                    <span style={{ color: "#5e5c58" }}>{v.contact_email}</span>
                  </div>
                ))}
              </div>

              {/* Email preview */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>
                  Preview — first venue
                </p>
                <div className="rounded-lg px-4 py-3 space-y-2" style={{ backgroundColor: "#0e0f11", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <p className="text-xs font-medium" style={{ color: "#9a9591" }}>Subject: <span style={{ color: "#f0ede8" }}>{previewSubject}</span></p>
                  <pre className="text-xs whitespace-pre-wrap max-h-48 overflow-y-auto" style={{ color: "#9a9591", fontFamily: "inherit", lineHeight: 1.6 }}>
                    {previewBody}
                  </pre>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg" style={{ color: "#9a9591" }}>
                Cancel
              </button>
              <button
                onClick={handleSend}
                className="text-sm px-4 py-2 rounded-lg font-semibold"
                style={mode === "pitch" ? { backgroundColor: "#d4a853", color: "#0e0f11" } : { backgroundColor: "#9b7fe8", color: "#0e0f11" }}
              >
                Send to {venues.length} venue{venues.length !== 1 ? "s" : ""} →
              </button>
            </div>
          </>
        )}

        {/* Sending step */}
        {step === "sending" && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-4">
            <div className="w-full rounded-full overflow-hidden" style={{ backgroundColor: "#262b33", height: "4px" }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${venues.length > 0 ? Math.round((progress / venues.length) * 100) : 0}%`,
                  backgroundColor: mode === "pitch" ? "#d4a853" : "#9b7fe8",
                }}
              />
            </div>
            <p className="text-sm" style={{ color: "#9a9591" }}>
              Sending {Math.min(progress + 1, venues.length)} of {venues.length}…
            </p>
          </div>
        )}

        {/* Results step */}
        {step === "results" && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: successCount > 0 ? "rgba(76,175,125,0.15)" : "rgba(226,92,92,0.15)" }}>
                  <span style={{ fontSize: "1.2rem" }}>{successCount > 0 ? "✓" : "✗"}</span>
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: "#f0ede8" }}>
                    {successCount} of {results.length} sent successfully
                  </p>
                  {failCount > 0 && (
                    <p className="text-xs" style={{ color: "#e25c5c" }}>{failCount} failed — see below</p>
                  )}
                </div>
              </div>

              {failCount > 0 && (
                <div className="space-y-1">
                  {results.filter((r) => !r.success).map((r) => (
                    <div key={r.venueId} className="text-xs px-3 py-2 rounded" style={{ backgroundColor: "rgba(226,92,92,0.08)", color: "#e25c5c", border: "1px solid rgba(226,92,92,0.2)" }}>
                      {r.venueName}: {r.error}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end px-6 py-4 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <button
                onClick={() => onComplete(results, sentVenueIds)}
                className="text-sm px-4 py-2 rounded-lg font-semibold"
                style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors (may have errors in PipelineView about missing BatchEmailModal import — fix in next task).

- [ ] **Step 3: Commit**

```bash
git add components/pipeline/BatchEmailModal.tsx
git commit -m "feat: BatchEmailModal — confirm, send loop, results"
```

---

## Task 9: Wire BatchEmailModal into PipelineView

**Files:**
- Modify: `components/pipeline/PipelineView.tsx`

- [ ] **Step 1: Import BatchEmailModal and SendResult**

Add to the imports in `PipelineView.tsx`:
```typescript
import BatchEmailModal, { SendResult } from "@/components/pipeline/BatchEmailModal";
```

- [ ] **Step 2: Add handleBatchComplete function**

Add this function inside `PipelineView`, after the existing batch handlers:
```typescript
  async function handleBatchComplete(results: SendResult[], sentVenueIds: string[]) {
    // For pitch: advance successfully-pitched venues to "contacted" — update DB and local state
    if (batchMode === "pitch" && sentVenueIds.length > 0) {
      // Patch each venue stage in the DB (fire-and-forget, non-blocking)
      sentVenueIds.forEach((id) => {
        fetch(`/api/venues/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "contacted" }),
        }).catch(() => {/* ignore — router.refresh() will correct any mismatch */});
      });
      // Optimistic local state update
      setVenues((prev) =>
        prev.map((v) =>
          sentVenueIds.includes(v.id) ? { ...v, stage: "contacted" as const } : v
        )
      );
    }
    setBatchModalOpen(false);
    setBatchMode(null);
    setSelectedVenueIds(new Set());
    // Refresh server data so outreachMap reflects new interactions
    router.refresh();
  }
```

- [ ] **Step 3: Render BatchEmailModal in PipelineView JSX**

Find the section where `PitchEmailModal` is rendered and add `BatchEmailModal` right after it:

```tsx
      {batchModalOpen && batchMode && (
        <BatchEmailModal
          venues={
            // Only pass selected, eligible venues (those with a contact_email)
            venues
              .filter((v) => selectedVenueIds.has(v.id) && v.contact_email?.trim())
          }
          mode={batchMode}
          onClose={() => {
            setBatchModalOpen(false);
          }}
          onComplete={handleBatchComplete}
        />
      )}
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: End-to-end smoke test**

Run `npm run dev`. Go to `/pipeline`:
1. Click "Send Batch Pitch" in the Discovered column
2. Select a few venues using checkboxes
3. Click "Select All" — all eligible venues should be selected
4. Click the floating "Send Pitch to X" bar
5. Confirm modal opens with venue list and email preview
6. Click Send — progress bar runs, emails send
7. Results screen shows success/fail counts
8. Click Done — venues in the Discovered column should move to Contacted, modal closes

Repeat with "Send Follow-up" in the Contacted column.

- [ ] **Step 6: Commit**

```bash
git add components/pipeline/PipelineView.tsx
git commit -m "feat: wire BatchEmailModal into PipelineView with stage advancement and refresh"
```

---

## Task 10: Push to production

- [ ] **Step 1: Run a full TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Fix any lint errors before pushing.

- [ ] **Step 3: Push to Vercel**

```bash
git push origin main
```

Vercel will auto-deploy. Visit `stagereach.app/pipeline` once the deploy completes and test the full flow.

- [ ] **Step 4: Run Supabase migration**

In the Supabase dashboard for this project, go to **SQL Editor** and run the contents of `supabase/migrations/012_interactions_followup_type.sql`. It will print a notice and complete immediately.
