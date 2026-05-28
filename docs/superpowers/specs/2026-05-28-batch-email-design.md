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

- Each sent email logs an interaction (type: "email") on the venue — same as individual sends
- Venues in the **pitch** batch automatically advance from `discovered` → `contacted` stage
- Venues in the **follow-up** batch stay in `contacted` (stage does not change)

---

## Architecture

### New component: `BatchEmailModal.tsx`

Location: `components/pipeline/BatchEmailModal.tsx`

Responsibilities:
- Receives the list of selected venues and the email type (`"pitch"` | `"follow_up"`)
- Loads the artist profile from `/api/artist-profile` to build the email preview
- Renders the confirm screen and progress state
- Calls `/api/send-email` for each venue in sequence
- On pitch batch completion, calls `PATCH /api/venues/[id]` to advance each venue to `contacted`
- Reports results back to the parent via `onComplete(results)`

### Changes to `PipelineView.tsx`

- Add `batchMode` state per column (`null | "pitch" | "followup"`)
- Add `selectedVenueIds` state (Set of venue IDs)
- Render batch buttons in Discovered and Contacted column headers
- When in batch mode: render checkboxes on venue cards, Select All toggle, floating action bar
- On Send: open `BatchEmailModal` with selected venues
- On complete: update local venue state (stage advances for pitched venues), exit batch mode

### No new API endpoints

All sending goes through the existing `POST /api/send-email`. Stage updates use the existing `PATCH /api/venues/[id]`. No backend changes needed.

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

## Edge Cases

- **No email on file**: venue is shown disabled in select mode, never included in the send loop
- **Already followed up**: for the follow-up flow, venues with an existing follow-up interaction are disabled
- **Partial failure**: if some sends fail (network error, Resend API error), the modal shows a per-venue result list so the artist knows which venues to retry manually
- **Empty column**: batch buttons only render when there are eligible venues in that stage

---

## Files Touched

| File | Change |
|------|--------|
| `components/pipeline/PipelineView.tsx` | Add batch mode state, buttons, select UI, open modal |
| `components/pipeline/BatchEmailModal.tsx` | New — confirm + progress + send loop |
| `components/pipeline/KanbanBoard.tsx` | Pass batch mode props down to column headers if needed |
