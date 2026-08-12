# Onboarding Email Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required 5th step to the onboarding wizard where new artists connect Gmail or Outlook before reaching their dashboard, with a fallback to continue if the connection genuinely fails.

**Architecture:** Move the wizard's existing database save (currently triggered only by the final "Let's go!" click) one step earlier, to the step 4→5 transition, so a full-page OAuth round trip never loses in-progress form data or gets bounced by the app's login-guard. Step 5 links to the already-live OAuth connect routes unchanged. A short-lived cookie tags an OAuth attempt as "belongs to onboarding" so a failure routes back to step 5 instead of silently landing on the Artist Profile page.

**Tech Stack:** Next.js App Router (client components), Supabase, existing Gmail/Outlook OAuth infrastructure (already deployed and verified working in production — this plan does not touch it).

**No automated test suite exists in this project** (confirmed in CLAUDE.md: "No test suite is currently configured"). Per the skill's priority rules, this project fact overrides the default TDD task structure below. Every task substitutes `npx tsc --noEmit`, `npx eslint <file>`, and concrete manual browser verification instead of automated tests — consistent with how the rest of this codebase has been verified all along.

**Unlike the plan this builds on** (`docs/superpowers/plans/2026-08-11-personal-email-oauth.md`), there is no external Google Cloud / Azure setup blocking full manual verification here — the OAuth apps, scopes, and redirect URIs are already configured and proven working end-to-end in production. The only thing manual verification needs that an implementer subagent can't provide is **a fresh, never-onboarded Supabase user account** to actually click through the wizard as a new artist — that step is called out explicitly as something for Taylor to do, not the implementer.

---

### Task 1: Restructure the onboarding wizard — move the save earlier, add step 5

**Files:**
- Modify: `app/onboarding/page.tsx`

This is the only file with real logic changes. Read the current file in full first — it's a single ~450-line client component with a 4-step wizard driven by a `step` state variable and one big save function (`finish`/`doFinish`) currently wired to the step-4 "Let's go! 🎸" button and its "Skip for now" link.

- [ ] **Step 1: Add the missing `useEffect` import**

This file currently only imports `useState` and `useRef` from React — `useEffect` (needed for Steps 3 and later) isn't imported yet. Change:
```typescript
import { useState, useRef } from "react";
```
to:
```typescript
import { useState, useEffect, useRef } from "react";
```

- [ ] **Step 2: Extend the `Step` type and progress bar for 5 steps**

Change:
```typescript
type Step = 1 | 2 | 3 | 4;
```
to:
```typescript
type Step = 1 | 2 | 3 | 4 | 5;
```

In the `ProgressBar` component, change:
```typescript
function ProgressBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {[1, 2, 3, 4].map((s) => (
        <div
          key={s}
          className="h-1 flex-1 rounded-full transition-colors duration-300"
          style={{ backgroundColor: s <= step ? "#9b7fe8" : "#262b33" }}
        />
      ))}
      <span className="text-xs ml-3 shrink-0" style={{ color: "#9a9591" }}>
        Step {step} of 4
      </span>
    </div>
  );
}
```
to:
```typescript
function ProgressBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {[1, 2, 3, 4, 5].map((s) => (
        <div
          key={s}
          className="h-1 flex-1 rounded-full transition-colors duration-300"
          style={{ backgroundColor: s <= step ? "#9b7fe8" : "#262b33" }}
        />
      ))}
      <span className="text-xs ml-3 shrink-0" style={{ color: "#9a9591" }}>
        Step {step} of 5
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Add new state for the email-connect step**

Alongside the existing `useState` declarations near the top of `OnboardingPage`, add:

```typescript
  // Step 5: email connect
  const [emailConnectError, setEmailConnectError] = useState<string | null>(null);
```

- [ ] **Step 4: Add the onMount effect that detects a failed-connection return and sets the onboarding-origin cookie**

Add this `useEffect` inside `OnboardingPage`, alongside the other hooks (near the top, after the state declarations):

```typescript
  // If we're landing here after a failed OAuth attempt (redirected from the
  // Artist Profile page's error handling — see that page's own useEffect),
  // jump straight to step 5 instead of defaulting to step 1. This can't be
  // done as a useState lazy initializer — window.location isn't available
  // during server rendering, and reading it there would cause a hydration
  // mismatch between the server render and the client's first render, the
  // exact same class of bug already hit and fixed once on the Artist
  // Profile page. An effect that runs after mount avoids that.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a post-redirect URL param, same justified pattern already used in app/(protected)/artist-profile/page.tsx
      setStep(5);
      setEmailConnectError("That didn't work — you can try again, or connect later from your profile.");
      window.history.replaceState({}, "", "/onboarding");
    }
  }, []);

  // Whenever step 5 is shown (whether by normal progression or by the
  // effect above returning here after a failure), tag the next OAuth
  // outcome as belonging to onboarding. A fresh cookie is set on every
  // arrival at step 5 so a retry after a failure is tagged again too.
  useEffect(() => {
    if (step === 5) {
      document.cookie = "onboarding_email_connect=1; path=/; max-age=600; SameSite=Lax";
    }
  }, [step]);
```

Note: arriving here via `?error=...` will briefly paint step 1 for one frame before this effect flips it to step 5 (the effect only runs after the initial mount/paint) — not worth avoiding given how rarely this path is hit, just don't be surprised by it during manual testing. If `npx eslint` in Step 8 below flags the `setEmailConnectError` call on the line after the disabled one, apply the same disable-comment pattern to it too — the rule reports per state-setter, so a second call in the same block may or may not need its own comment depending on what the linter actually flags; let the real lint output decide rather than adding a speculative second comment now.

- [ ] **Step 5: Move the save logic out of `finish`/`doFinish` and into a new step-4→5 transition function**

Currently, `finish()` wraps `doFinish()` in a try/catch, and `doFinish()` does the photo upload, profile PATCH, and zone save, ending with `router.push("/dashboard")`. Rename and restructure so the save advances to step 5 instead of navigating away.

Replace:
```typescript
  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await doFinish();
    } catch (err) {
      console.error("Onboarding finish error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(`Something went wrong (${msg}) — please try again.`);
      setSaving(false);
    }
  }

  async function doFinish() {
```
with:
```typescript
  async function saveProfileAndContinue() {
    setSaving(true);
    setError(null);
    try {
      await doSaveProfile();
    } catch (err) {
      console.error("Onboarding save error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(`Something went wrong (${msg}) — please try again.`);
      setSaving(false);
    }
  }

  async function doSaveProfile() {
```

Then find the end of that function — currently:
```typescript
      if (zoneError) {
        setError("Failed to save region: " + zoneError.message);
        setSaving(false);
        return;
      }
    }

    router.push("/dashboard");
  }
```
and change the final line so it advances to step 5 instead of navigating away:
```typescript
      if (zoneError) {
        setError("Failed to save region: " + zoneError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setStep(5);
  }
```

(Everything else inside `doSaveProfile` — the photo upload block, the `artist-profile` PATCH call, the zone upsert-or-insert logic — is unchanged. Only the function names and that final block change.)

- [ ] **Step 6: Wire step 4's two controls to the renamed function**

In the step-4 JSX block, find:
```tsx
            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className="flex-1 rounded-lg py-2 text-sm" style={backBtn}>← Back</button>
              <button
                onClick={finish}
                disabled={saving}
                className="flex-[2] rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
              >
                {saving ? "Saving…" : "Let's go! 🎸"}
              </button>
            </div>
            <button onClick={finish} disabled={saving} className="w-full mt-3 text-xs disabled:opacity-50" style={{ color: "#5e5c58" }}>Skip for now</button>
```

Replace with (both controls now call `saveProfileAndContinue`, and the primary button's label changes since it now advances to a step, not to the dashboard):

```tsx
            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className="flex-1 rounded-lg py-2 text-sm" style={backBtn}>← Back</button>
              <button
                onClick={saveProfileAndContinue}
                disabled={saving}
                className="flex-[2] rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
              >
                {saving ? "Saving…" : "Continue →"}
              </button>
            </div>
            <button onClick={saveProfileAndContinue} disabled={saving} className="w-full mt-3 text-xs disabled:opacity-50" style={{ color: "#5e5c58" }}>Skip for now</button>
```

- [ ] **Step 7: Add the step 5 JSX block**

Immediately after the closing `)}` of the step-4 block — right before the two wrapping `</div>` tags that close out the card and the outer centered container (the last lines of the component's `return`) — add:

```tsx
        {/* ── Step 5 ── */}
        {step === 5 && (
          <div>
            <h2 className="text-base font-semibold mb-1" style={{ color: "#F4E8D2" }}>Connect your email</h2>
            <p className="text-xs mb-5" style={{ color: "#9a9591" }}>
              Pitch and follow-up emails will send from your own address instead of a shared one. Takes about a minute.
            </p>

            {emailConnectError && (
              <p className="text-xs rounded-lg px-3 py-2 mb-4" style={{ color: "#e25c5c", backgroundColor: "rgba(226,92,92,0.1)", border: "1px solid rgba(226,92,92,0.2)" }}>
                {emailConnectError}
              </p>
            )}

            <div className="flex flex-col gap-2.5">
              <a
                href="/api/auth/gmail/connect"
                className="w-full rounded-lg py-2 text-sm font-semibold text-center"
                style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
              >
                Connect Gmail
              </a>
              <a
                href="/api/auth/outlook/connect"
                className="w-full rounded-lg py-2 text-sm font-semibold text-center"
                style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
              >
                Connect Outlook
              </a>
            </div>

            {emailConnectError && (
              <button
                onClick={() => router.push("/dashboard")}
                className="w-full mt-4 text-xs"
                style={{ color: "#5e5c58" }}
              >
                Continue without connecting for now
              </button>
            )}
          </div>
        )}
```

Note there is deliberately no "Skip for now" link here unless `emailConnectError` is set — per the spec, this step has no upfront bypass, only a fallback that appears after an observed failure.

- [ ] **Step 8: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint app/onboarding/page.tsx
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add app/onboarding/page.tsx
git commit -m "feat: add required email-connect step to onboarding wizard"
```

---

### Task 2: Route a failed onboarding connection back to step 5

**Files:**
- Modify: `app/(protected)/artist-profile/page.tsx:103-125`

This is the existing `useEffect` that loads connection status and reads `?connected=`/`?error=` from the URL after an OAuth redirect. It needs one addition: detect the onboarding-origin cookie set in Task 1, clear it on any outcome, and on the error branch specifically, redirect to `/onboarding?error=...` instead of showing this page's own banner.

- [ ] **Step 1: Read the current block to confirm nothing has shifted**

The current content (verify this matches before editing — if line numbers have drifted, find the block by content instead):

```typescript
  useEffect(() => {
    async function loadConnections() {
      const res = await fetch("/api/email-connections");
      if (res.ok) {
        const data: { connections: EmailConnection[] } = await res.json();
        setConnections(data.connections);
      }
      setConnectionsLoading(false);
    }
    loadConnections();

    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected === "gmail" || connected === "outlook") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a post-redirect URL param to show a banner; not state synced from props/state, hydration-safe since it only runs client-side after mount
      setConnectBanner({ type: "success", message: `${connected === "gmail" ? "Gmail" : "Outlook"} connected.` });
      window.history.replaceState({}, "", "/artist-profile");
    } else if (error) {
      setConnectBanner({ type: "error", message: "Couldn't connect — please try again." });
      window.history.replaceState({}, "", "/artist-profile");
    }
  }, []);
```

- [ ] **Step 2: Add the cookie check and onboarding redirect**

Replace it with:

```typescript
  useEffect(() => {
    async function loadConnections() {
      const res = await fetch("/api/email-connections");
      if (res.ok) {
        const data: { connections: EmailConnection[] } = await res.json();
        setConnections(data.connections);
      }
      setConnectionsLoading(false);
    }
    loadConnections();

    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");

    // The onboarding wizard sets this cookie right before sending the artist
    // to Google/Microsoft, to tag "the next OAuth outcome belongs to
    // onboarding." Once any outcome (success or failure) has been observed
    // here, it's spent and must be cleared either way — otherwise an
    // unrelated later reconnect attempt from this page, within the cookie's
    // short window, could get misrouted back into the onboarding wizard.
    const fromOnboarding = document.cookie.includes("onboarding_email_connect=1");
    if (fromOnboarding) {
      document.cookie = "onboarding_email_connect=; path=/; max-age=0";
    }

    if (connected === "gmail" || connected === "outlook") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a post-redirect URL param to show a banner; not state synced from props/state, hydration-safe since it only runs client-side after mount
      setConnectBanner({ type: "success", message: `${connected === "gmail" ? "Gmail" : "Outlook"} connected.` });
      window.history.replaceState({}, "", "/artist-profile");
    } else if (error) {
      if (fromOnboarding) {
        window.location.replace(`/onboarding?error=${encodeURIComponent(error)}`);
        return;
      }
      setConnectBanner({ type: "error", message: "Couldn't connect — please try again." });
      window.history.replaceState({}, "", "/artist-profile");
    }
  }, []);
```

- [ ] **Step 3: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint "app/(protected)/artist-profile/page.tsx"
```
Expected: no errors, and no new `unused-eslint-disable-directive` or `set-state-in-effect` warnings beyond the one already-justified one on the `connected` branch (the new `error`-branch code doesn't call `setConnectBanner` when `fromOnboarding` is true, so it doesn't trip that rule).

- [ ] **Step 4: Commit**

```bash
git add "app/(protected)/artist-profile/page.tsx"
git commit -m "feat: route a failed onboarding email connection back to the wizard"
```

---

### Task 3: Manual end-to-end verification

This cannot be done by an implementer subagent — it requires a real browser and a **fresh Supabase auth user who hasn't completed onboarding yet** (an existing account like Taylor's own won't show the wizard at all, since `proxy.ts` only routes users with no saved `artist_profiles.display_name` there). This task is for Taylor, not an automated step.

- [ ] **Step 1: Create or use a fresh test account**

Sign up a new test account (e.g. via `/signup` with a throwaway email, or use a Supabase test user that has no `artist_profiles` row yet), and land on `/onboarding`.

- [ ] **Step 2: Walk through steps 1-4 normally**

Fill in name, region, (optionally skip links), then click "Continue →" on step 4. Expected: no navigation away — the page advances to step 5, progress bar shows "Step 5 of 5".

- [ ] **Step 3: Confirm the profile was actually saved at this point**

In the Supabase SQL Editor:
```sql
select display_name from artist_profiles where user_id = '<the test user's id>';
```
Expected: the name entered in step 1, confirming the save now happens before step 5 rather than at a final click that hasn't happened yet.

- [ ] **Step 4: Connect an account successfully**

Click "Connect Gmail" or "Connect Outlook", complete the provider's consent screen. Expected: redirected to `/artist-profile?connected=...`, showing the existing green success banner. Confirm in Supabase:
```sql
select provider, status from email_connections where user_id = '<the test user's id>';
```
Expected: one row, `status = 'active'`.

- [ ] **Step 5: Confirm the fallback path (deliberately triggering a failure)**

Repeat steps 1-3 with a second fresh test account, but on step 5, deliberately cause a failure — the simplest way is to click "Connect Gmail", then click **Cancel/Deny** on Google's own consent screen instead of approving. Expected: redirected back to `/onboarding` (not `/artist-profile`), landing directly on step 5 (not step 1), showing the red error message and a "Continue without connecting for now" link. Click that link. Expected: navigates to `/dashboard` successfully, with no connected account and no error blocking access.

- [ ] **Step 6: Confirm the cookie doesn't leak into unrelated later activity**

Using the first (successfully-connected) test account from Step 4, wait a few seconds, then go to Artist Profile → Connected Accounts → Disconnect → Connect the same provider again. Expected: this reconnect works and lands back on `/artist-profile` normally (not misrouted to `/onboarding`), confirming the cookie was correctly cleared after the earlier successful connect and isn't stale.
