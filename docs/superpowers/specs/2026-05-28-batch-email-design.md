# Batch Email Design

## Overview

Artists can send personalized pitch emails to multiple discovered venues at once, and follow-up emails to multiple contacted venues at once, directly from the Pipeline page. Both flows use a checkbox select mode with a Select All toggle, a confirm modal with an email preview, and send via the existing `/api/send-email` endpoint.

---

## Goals

- Save time: instead of opening each venue individually to send a pitch, fire off a batch in one action
- Two flows: initial pitch (Discovered stage) and follow-up (Contacted stage)
- Artist stays in control: they choose which venues to include before anything is sent
- No new email infrastructure: reuse the existing `/api/send-email` endpoint and email templates

## Non-Goals

- Automatic/scheduled sending (manual only)
- Email template editing in the batch flow (uses existing templates)
- Batch sending from any stage other than Discovered and Contacted

---

## UI

### Pipeline page — two new buttons

**Discovered column header:**
A gold "✉ Send Batch Pitch" button sits below the column title. Visible only when there is at least one venue in the Discovered stage.

**Contacted column header:**
A purple "↩ Send Follow-up" button sits below the column title. Visible only when there is at least one venue in the Contacted stage that has not yet received a follow-up.

### Select mode

Clicking either button switches that column into select mode:

- A "Select All / Deselect All" toggle appears at the column top
- Each venue card gets a checkbox
- Venues with no `contact_email` are shown but disabled and labelled "no email"
- For the follow-up button: venues that already have a follow-up interaction logged are also disabled and labelled "already followed up"
- A floating action bar appears at the bottom of the column showing the selected count and a Send button
- A Cancel link exits select mode without sending anything

### Confirm modal

After hitting Send, a modal opens showing:
- How many venues will receive the email
- How many are being skipped (no email / already followed up)
- A scrollable preview of the email body (using the same `buildBody` / `buildFollowUpBody` templates from `PitchEmailModal.tsx`, populated with the artist's real profile data)
- A "Send to X venues" confirm button and a Cancel button

### Sending progress

After confirming, the modal shows a progress state: "Sending 2 of 9…". Emails are sent sequentially via the existing `/api/send-email` endpoint. On completion, a success summary shows how many were sent and how many failed (if any).

### Post-send

- Pitch emails log an interaction with `type: "email"` — same as individual sends
- Follow-up emails log an interaction with `type: "follow_up"`. This requires adding `"follow_up"` to the `InteractionType` union in `types/index.ts` and passing an optional `interaction_type` field to `POST /api/send-email` (defaults to `"email"` if omitted, so existing individual sends are unaffected)
- Venues in the **pitch** batch automatically advance from `discovered` → `contacted` stage
- Venues in the **follow-up** batch stay in `contacted` (stage does not change)
- "Already followed up" is detected via `outreachMap`. The map's value shape expands to `{ count: number; lastDate: string | null; hasFollowUp: boolean }`. `PipelinePage` sets `hasFollowUp: true` for any venue that has an interaction with `type: "follow_up"`. `PipelineView`'s prop type is updated to match. The `interactions` select query in `pipeline/page.tsx` already fetches `type` — this just uses it

---

## Architecture

### New file: `lib/email-templates.ts`

Extract `buildSubject`, `buildFollowUpSubject`, `buildBody`, and `buildFollowUpBody` from `PitchEmailModal.tsx` into a shared utility file at `lib/email-templates.ts`. Both `PitchEmailModal` and `BatchEmailModal` import from this shared file. No logic changes — pure extraction.

### New component: `BatchEmailModal.tsx`

Location: `components/pipeline/BatchEmailModal.tsx`

Responsibilities:
- Receives the list of selected venues and the email type (`"pitch"` | `"follow_up"`)
- Loads the artist profile from `/api/artist-profile` to build the email preview (preview shows the email as it will be sent to the **first** selected venue, labelled "Preview — first venue")
- Renders the confirm screen and progress state
- Calls `POST /api/send-email` for each venue in sequence, passing `interaction_type: "follow_up"` when in follow-up mode
- On pitch batch completion, calls `PATCH /api/venues/[id]` for each successfully sent venue to advance stage to `contacted`
- Reports results back to the parent via `onComplete(results)`

### Changes to `PipelineView.tsx`

`PipelineView` owns all batch state — this keeps it co-located with `venues` state and the existing drag-and-drop logic.

- Add `batchMode` state: `null | "pitch" | "followup"` (only one column can be in batch mode at a time)
- Add `selectedVenueIds` state: `Set<string>`
- Pass `batchMode`, `selectedVenueIds`, and batch callbacks (`onBatchStart`, `onToggleSelect`, `onSelectAll`, `onBatchSend`, `onBatchCancel`) down through `KanbanBoard` to the relevant column headers and venue cards
- When in batch mode: the relevant column renders checkboxes on venue cards, Select All toggle, floating action bar; drag-and-drop is disabled for that column while in select mode
- On Send: open `BatchEmailModal` with selected venues and email type
- On complete (`onComplete(results)`): update local `venues` state to advance pitched venues to `contacted`, clear batch state

### Changes to `KanbanBoard.tsx` / column headers

- Accept and thread through the batch props from `PipelineView`
- Render "Send Batch Pitch" button in Discovered header and "Send Follow-up" button in Contacted header
- Render Select All toggle and a floating action bar **fixed to the bottom of the viewport** (not the column scroll area) when in batch mode, so it's always visible regardless of scroll position
- When in batch mode, venue cards in the active column render with `isDragDisabled={true}` on their `Draggable` wrapper (the `@hello-pangea/dnd` prop) to disable drag while selecting

### Minor API change: `POST /api/send-email`

Add an optional `interaction_type` field to the request body. Defaults to `"email"` if omitted (backward compatible). When `"follow_up"` is passed, the logged interaction uses that type instead. No other endpoint changes needed — stage updates use the existing `PATCH /api/venues/[id]`.

### Database migration required

A Supabase migration must add `"follow_up"` as an allowed value for the `type` column on the `interactions` table (in case a check constraint exists). Migration file: `supabase/migrations/012_interactions_followup_type.sql`. The migration uses `ALTER TABLE` to add the new value if the column is constrained, or is a no-op comment if the column is free-form text.

---

## Data Flow

1. User clicks "Send Batch Pitch" → Discovered column enters select mode
2. User selects venues (or Select All) → clicks Send
3. `BatchEmailModal` opens → fetches artist profile → renders email preview
4. User confirms → modal iterates through selected venues:
   - `POST /api/send-email` with `{ to, subject, body, venue_id, user_id }`
   - On success: mark venue as sent in local state
   - On failure: mark venue as failed, continue to next
5. After all sends:
   - `PATCH /api/venues/[id]` for each successfully-pitched venue → stage: "contacted"
   - Parent state updated to reflect new stages
6. Success summary shown → user dismisses → back to normal pipeline view

---

## Implementation Notes

- **Send rate**: Add a ~200ms delay between sends in the `BatchEmailModal` loop to avoid Resend rate-limit errors on large batches
- **Stale outreachMap**: After batch completion, call `router.refresh()` in `PipelineView` so the server re-fetches `outreachMap` with the newly logged interactions — this ensures `hasFollowUp` flags are accurate on next use

## Edge Cases

- **No email on file**: venue is shown disabled in select mode, never included in the send loop
- **Already followed up**: for the follow-up flow, venues with an existing follow-up interaction are disabled
- **Partial failure**: if some sends fail (network error, Resend API error), the modal shows a per-venue result list so the artist knows which venues to retry manually
- **Empty column**: batch buttons only render when there are eligible venues in that stage

---

## Files Touched

| File | Change |
|------|--------|
| `supabase/migrations/012_interactions_followup_type.sql` | New — add "follow_up" as allowed interaction type |
| `types/index.ts` | Add `"follow_up"` to `InteractionType` union; expand `outreachMap` value type |
| `lib/email-templates.ts` | New — extract shared email build functions from `PitchEmailModal.tsx` |
| `components/venue/PitchEmailModal.tsx` | Import template functions from `lib/email-templates.ts` instead of defining them locally |
| `app/api/send-email/route.ts` | Accept optional `interaction_type` field; use it when logging interaction |
| `app/(protected)/pipeline/page.tsx` | Expand `outreachMap` to include `hasFollowUp: boolean` using the `type` field already fetched |
| `components/pipeline/PipelineView.tsx` | Add batch mode state, pass props to KanbanBoard, open BatchEmailModal, handle onComplete |
| `components/pipeline/KanbanBoard.tsx` | Thread batch props down to `KanbanColumn` |
| `components/pipeline/KanbanColumn.tsx` | Render batch button, Select All toggle, floating action bar; pass checkbox prop to venue cards |
| `components/venue/VenueCard.tsx` | Accept `batchSelected` / `batchDisabled` props; render checkbox overlay when in batch mode; pass `isDragDisabled` to `Draggable` |
| `components/pipeline/BatchEmailModal.tsx` | New — confirm screen, email preview, send loop with small delay between sends (~200ms), progress, results |
