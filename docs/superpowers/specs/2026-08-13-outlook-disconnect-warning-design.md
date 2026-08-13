# Warn Before Disconnecting Outlook (Calendar Sync Impact) — Design

## Overview

The Connected Accounts card on the Artist Profile page (`app/(protected)/artist-profile/page.tsx`) lets an artist disconnect Gmail or Outlook with a single click. For Outlook specifically, that one click also silently turns off gig calendar sync, since both features share the same OAuth connection — there's currently nothing telling the artist that's about to happen. This adds a confirm step to Outlook's Disconnect button only, following the exact same inline confirm pattern this app already uses elsewhere (invoice deletion).

---

## Goals

- An artist disconnecting Outlook sees, before it happens, that this also stops calendar sync
- Gmail's disconnect behavior is completely unchanged — it doesn't affect calendar sync, so it doesn't need a warning
- Follow the app's existing confirm-step pattern exactly (`components/invoice/DeleteInvoiceButton.tsx`) rather than introducing a new interaction style (native browser `confirm()`, a modal, etc.)
- No change to what disconnecting actually does — `disconnectAccount()` and the `DELETE /api/email-connections` route are untouched

## Non-Goals

- No changes to the Gmail row or Gmail's disconnect flow
- No changes to any API route, database table, or the disconnect logic itself — this is purely a confirm-step added in front of an existing, unchanged action
- Not building a reusable/generic confirm-button component — the existing `DeleteInvoiceButton` pattern is copied inline into this one card, matching how the codebase already duplicates this pattern rather than abstracting it (there's no shared "confirm button" component today)

---

## What Changes

### New state: which provider (if any) is mid-confirm

A single piece of state tracks whether the Outlook row is currently showing its confirm step:

```typescript
const [confirmingDisconnect, setConfirmingDisconnect] = useState<"outlook" | null>(null);
```

(Typed to `"outlook" | null` rather than `"gmail" | "outlook" | null` — Gmail never enters this state, so there's no reason to make the type wider than what's actually used.)

### Outlook's row: three visual states instead of two

Currently the Outlook row (like Gmail's) shows either "Connect" (not connected / needs reconnect) or "Disconnect" (active). That becomes three states, mirroring `DeleteInvoiceButton`'s `confirming` boolean exactly:

1. **Not connected / needs reconnect** — unchanged, shows the gold "Connect" link.
2. **Connected, not confirming** — shows the existing "Disconnect" button, but its `onClick` now calls `setConfirmingDisconnect("outlook")` instead of calling `disconnectAccount("outlook")` directly.
3. **Connected, confirming** (`confirmingDisconnect === "outlook"`) — replaces the Disconnect button with inline warning text and two buttons, styled to match `DeleteInvoiceButton`'s confirm state (same font size, same red/muted color treatment, same inline-flex layout):
   - Text: *"This will also stop syncing your gigs to your Outlook calendar. Disconnect anyway?"*
   - **"Yes, disconnect"** button — calls `disconnectAccount("outlook")` (the existing, unchanged function) and resets `confirmingDisconnect` to `null`
   - **"Cancel"** button — just resets `confirmingDisconnect` to `null`, no other side effect

### Gmail's row: unchanged

Gmail's "Disconnect" button keeps its current `onClick={() => disconnectAccount("gmail")}` — no confirm step, no new state involvement.

---

## Data Flow

1. Artist clicks "Disconnect" on the Outlook row → `confirmingDisconnect` is set to `"outlook"` → that row re-renders showing the warning text + Yes/Cancel buttons in place of the Disconnect button. No network request happens yet.
2. **Cancel** → `confirmingDisconnect` reset to `null` → row reverts to showing "Disconnect" again. Nothing else changed.
3. **Yes, disconnect** → calls the existing `disconnectAccount("outlook")` (unchanged: `DELETE /api/email-connections?provider=outlook`, then either removes the connection from local state on success or shows the existing "Couldn't disconnect" banner on failure) → `confirmingDisconnect` reset to `null` regardless of outcome, so the row doesn't get stuck showing the confirm state after the request resolves.
4. Gmail's disconnect flow is untouched — clicking its "Disconnect" button calls `disconnectAccount("gmail")` immediately, exactly as it does today.

---

## Files Touched

| File | Change |
|---|---|
| `app/(protected)/artist-profile/page.tsx` | Add `confirmingDisconnect` state; change Outlook's Disconnect button to a three-state render (Disconnect / confirming-with-warning / unchanged Connect state); Gmail's row and all other code in the file untouched |
