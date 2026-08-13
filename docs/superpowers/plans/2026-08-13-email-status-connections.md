# Personal Email Status in /api/email-status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `/api/email-status` diagnostic route to also report on the logged-in artist's personal Gmail/Outlook connection status, alongside the existing Resend checks, so there's one place to check "why isn't my email working."

**Architecture:** `pickConnection` (the function that decides which connected provider sending will actually use) is made generic and exported from `lib/email/send-artist-email.ts`, so the diagnostic route can reuse the exact real selection logic without duplicating it or needing to select sensitive OAuth token columns. The route then adds a new, self-contained section after its existing Resend checks.

**Tech Stack:** Next.js App Router, Supabase, TypeScript.

**No automated test suite exists in this project** (confirmed in `CLAUDE.md`). Verification for both tasks is `npx tsc --noEmit` / `npx eslint <file>`, plus a manual live check against the running dev server using a real browser session cookie.

---

### Task 1: Export `pickConnection` as a generic

**Files:**
- Modify: `lib/email/send-artist-email.ts`

- [ ] **Step 1: Make `pickConnection` generic and exported**

Find the existing `pickConnection` function (currently a private, non-exported function taking `EmailConnectionRow[]`), including the explanatory comment directly above it:

```typescript
// Note: updated_at is bumped by ANY token refresh, including ones triggered
// outside this file (e.g. app/api/calendar/sync/route.ts refreshing an
// Outlook token for calendar purposes, not sending). If a UI caller for
// calendar sync is ever added, a calendar-only action could incidentally
// change which provider "wins" here for the artist's next email send.
// Currently inert — calendar/sync has no UI caller anywhere in the app.
function pickConnection(connections: EmailConnectionRow[]): EmailConnectionRow | null {
  if (connections.length === 0) return null;
  const active = connections.filter((c) => c.status === "active");
  const pool = active.length > 0 ? active : connections;
  return pool.reduce((newest, c) =>
    new Date(c.updated_at) > new Date(newest.updated_at) ? c : newest
  );
}
```

Replace it with a generic, exported version, keeping the same comment (now also relevant to Task 2's caller, not just the original one — a calendar-only token refresh could silently change what `/api/email-status` reports too). The generic constraint only requires the two fields the logic actually reads (`status`, `updated_at`) — not the full row shape with OAuth tokens — so callers that don't have (or shouldn't fetch) token columns can still use it:

```typescript
// Note: updated_at is bumped by ANY token refresh, including ones triggered
// outside this file (e.g. app/api/calendar/sync/route.ts refreshing an
// Outlook token for calendar purposes, not sending). If a UI caller for
// calendar sync is ever added, a calendar-only action could incidentally
// change which provider "wins" here — for the artist's next email send,
// and for what /api/email-status reports as currently active.
// Currently inert — calendar/sync has no UI caller anywhere in the app.
export interface ConnectionStatusInfo {
  status: "active" | "needs_reconnect";
  updated_at: string;
}

export function pickConnection<T extends ConnectionStatusInfo>(connections: T[]): T | null {
  if (connections.length === 0) return null;
  const active = connections.filter((c) => c.status === "active");
  const pool = active.length > 0 ? active : connections;
  return pool.reduce((newest, c) =>
    new Date(c.updated_at) > new Date(newest.updated_at) ? c : newest
  );
}
```

The existing internal call site (inside `sendArtistEmail`) does not need to change — `EmailConnectionRow` already has `status` and `updated_at`, so it satisfies the new generic constraint automatically:

```typescript
const connection = pickConnection((connections as EmailConnectionRow[]) ?? []);
```

Do not export `EmailConnectionRow` itself — it's not needed outside this file (Task 2's caller defines its own narrower row type instead).

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint lib/email/send-artist-email.ts
```

Expected: no errors. This confirms the existing `sendArtistEmail` call site still type-checks against the new generic signature with zero changes needed there.

- [ ] **Step 3: Commit**

```bash
git add lib/email/send-artist-email.ts
git commit -m "feat: make pickConnection generic and exported for reuse in diagnostics"
```

---

### Task 2: Add personal connection status to `/api/email-status`

**Files:**
- Modify: `app/api/email-status/route.ts`

- [ ] **Step 1: Add the import**

At the top of the file, alongside the existing imports:

```typescript
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { pickConnection } from "@/lib/email/send-artist-email";
```

- [ ] **Step 2: Add the personal-connections section**

After the existing Resend `try { ... } catch (e) { ... }` block (the one ending with `report.resend_check_error = ...`), add a new section, still inside the `GET` function, before the final `return NextResponse.json(report, { status: 200 });`:

```typescript
  // Personal Gmail/Outlook connection status
  interface PersonalConnectionRow {
    provider: "gmail" | "outlook";
    connected_email: string;
    status: "active" | "needs_reconnect";
    updated_at: string;
  }

  try {
    const { data: connections, error: connectionsError } = await supabase
      .from("email_connections")
      .select("provider, connected_email, status, updated_at")
      .eq("user_id", user.id);

    if (connectionsError) {
      report.personal_email_check_error = `Exception: ${connectionsError.message}`;
    } else if (!connections || connections.length === 0) {
      report.personal_email = "No personal Gmail/Outlook connected — sending uses the shared StageReach address";
    } else {
      const rows = connections as PersonalConnectionRow[];

      for (const conn of rows) {
        const key = `personal_${conn.provider}`;
        report[key] = conn.status === "active"
          ? `✅ connected (${conn.connected_email})`
          : `⚠️ connected but needs reconnecting (${conn.connected_email})`;
      }

      // pickConnection only returns null when there are zero connections — when every
      // connection is needs_reconnect, it still returns the most-recently-updated one
      // (that's the one sendArtistEmail genuinely attempts before its own Resend fallback).
      // So the outcome line must check the returned row's own status, not just null-vs-not.
      const selected = pickConnection(rows);
      report.personal_email_active =
        selected && selected.status === "active"
          ? `✅ Sending will currently use: ${selected.provider === "gmail" ? "Gmail" : "Outlook"} (${selected.connected_email})`
          : "⚠️ No working personal connection — sending is currently falling back to the shared StageReach address";
    }
  } catch (e) {
    report.personal_email_check_error = `Exception: ${e instanceof Error ? e.message : String(e)}`;
  }
```

This mirrors the existing Resend section's `try/catch` + `report.<key> = ...` pattern exactly, so a failure here degrades gracefully (the rest of the report still returns) exactly like a Resend-side failure already does.

- [ ] **Step 3: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint app/api/email-status/route.ts
```

Expected: no errors.

- [ ] **Step 4: Manual verification against the running dev server**

With the dev server running (`npm run dev`) and logged into StageReach in a browser, visit `http://localhost:3000/api/email-status` directly. Expected: the existing Resend keys are unchanged, plus new keys reflecting your actual connection state. For example, an account with an active Outlook connection and no Gmail should show:

```json
{
  "...existing Resend keys...": "...",
  "personal_outlook": "✅ connected (your-email@example.com)",
  "personal_email_active": "✅ Sending will currently use: Outlook (your-email@example.com)"
}
```

Cross-check `personal_email_active` against the `email_connections` table directly (e.g. via the Supabase SQL Editor: `select provider, connected_email, status, updated_at from email_connections where user_id = '<your user id>';`) to confirm it names whichever row is `status = 'active'` with the latest `updated_at` — or, if every row is `needs_reconnect`, confirm it shows the fallback line instead of naming a broken connection.

- [ ] **Step 5: Commit**

```bash
git add app/api/email-status/route.ts
git commit -m "feat: report personal Gmail/Outlook connection status in /api/email-status"
```

---

### Task 3: Update project documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md's Diagnostics section**

Find the existing line describing `/api/email-status` and `/api/stripe-status` (currently: *"return a plain-language report of whether email sending and Stripe payouts are correctly configured"*). Update it to also mention personal connections, e.g.:

```
Diagnostics — /api/email-status and /api/stripe-status (both require login) return a plain-language report of whether email sending and Stripe payouts are correctly configured. /api/email-status also reports the logged-in artist's personal Gmail/Outlook connection status (if any) and which one sending will actually use, alongside the shared Resend checks. Useful for debugging delivery/payment issues without digging through provider dashboards.
```

- [ ] **Step 2: Add a CHANGELOG.md entry**

Add at the top of `CHANGELOG.md`, above the most recent existing entry, dated with today's actual date:

```markdown
## YYYY-MM-DD
- [Feature] The email diagnostics page (/api/email-status) now also shows whether you've connected a personal Gmail or Outlook account, whether it's healthy, and which one your pitch/follow-up emails are actually sending from right now — alongside the existing shared-sender checks.
```

(Replace `YYYY-MM-DD` with the actual date this task is completed.)

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document personal connection status in email diagnostics"
```
