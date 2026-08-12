# Connect Email During Onboarding — Design

## Overview

The 4-step onboarding wizard (`/onboarding`) gains a 5th step where new artists connect their Gmail or Outlook account before reaching the dashboard, using the personal email sending feature (Gmail/Outlook OAuth, `email_connections` table, Connected Accounts card) already built and live in production. Today, connecting is only discoverable later, on the Artist Profile page — most new artists never find it and default to the shared StageReach sender indefinitely. This makes it part of first-run setup instead, so every artist starts sending from their own address immediately.

---

## Goals

- Every new artist connects Gmail or Outlook as part of signing up, not as something they might stumble onto later
- No artist gets permanently stuck if the OAuth connection genuinely fails (Google/Microsoft outage, misconfigured app, network blip, accidental cancel)
- Reuse the existing OAuth routes, callback handling, and `email_connections` table exactly as they already work in production — no changes to that infrastructure
- Keep steps 1-4 of the wizard exactly as they are today

## Non-Goals

- No changes to the OAuth connect/callback routes themselves (`/api/auth/gmail/connect`, `/api/auth/callback/gmail`, and the Outlook equivalents) — they already redirect to `/artist-profile?connected=...` on success/error, and that behavior is reused as-is
- No changes to the existing Connected Accounts card on the Artist Profile page — artists can still connect/disconnect/reconnect there after onboarding, unchanged
- Not building a "required forever" gate — this only applies once, during the first-run wizard. An artist who disconnects later is never forced back through this flow.

---

## Why the Wizard's Save Timing Must Change

Today, none of the wizard's form data (name, phone, region, links, bio, photo) is written to the database until the final "Let's go! 🎸" click on step 4, which calls `doFinish()` — this uploads the photo (non-blocking), saves the artist profile, saves the zone, then navigates to `/dashboard`. Everything before that exists only in the page's React state (`useState`).

Connecting Gmail/Outlook requires leaving the app entirely (a full browser navigation to Google's or Microsoft's own consent screen) and coming back via the existing OAuth callback routes. Two problems follow from that, given the current save-at-the-end model:

1. **Lost progress**: navigating away unmounts the wizard's React state. Everything typed into steps 1-4 would be gone when the artist returns from the OAuth round-trip, since nothing was ever saved.
2. **Middleware bounce**: the app's route guard (`proxy.ts`) redirects any logged-in artist without a saved `artist_profiles.display_name` back to `/onboarding` — for every route except `/onboarding` and API routes. The existing OAuth callbacks redirect to `/artist-profile` on completion, which is *not* on that exemption list. An artist who hasn't saved a profile yet would land on `/artist-profile` after connecting, immediately get bounced back to `/onboarding`, and lose the `?connected=gmail` confirmation along with it.

**Fix**: move the database save (profile + zone, same logic `doFinish()` already has) one step earlier — to the transition from step 4 into the new step 5 — instead of waiting for a final click. By the time an artist reaches step 5 and clicks Connect, their profile is already saved, so:
- There's nothing left in memory that a page navigation could lose
- The existing callback's redirect to `/artist-profile` works correctly the first time, since the middleware no longer considers them incomplete

This is the only structural change to the existing 4 steps: step 4's button changes from "Let's go! 🎸" (finish + navigate to dashboard) to "Continue →" (save + advance to step 5), matching the visual pattern of steps 1-3. The photo upload, profile save, and zone save logic are unchanged — just triggered one step sooner. If that save fails, the artist stays on step 4 with the same inline error handling that exists today.

---

## Step 5: Connect Your Email

Shown after step 4's save succeeds. Visually matches the existing wizard steps (same card, same button styling) and reuses the same two-provider layout already proven on the Artist Profile page's Connected Accounts card.

- **Headline**: "Connect your email" — subcopy explains that pitch/follow-up emails will send from the artist's own address instead of a shared one, and that it takes about a minute.
- **Two buttons**: "Connect Gmail" and "Connect Outlook", each a plain link/navigation to the existing `/api/auth/gmail/connect` or `/api/auth/outlook/connect` route — no new OAuth code, this is a full-page navigation exactly like the Connected Accounts card already does.
- **No skip link shown by default** — per the "required" decision, this step doesn't offer an upfront way to bypass connecting, unlike steps 3 and 4.
- **On success**: the existing callback redirects to `/artist-profile?connected=gmail` (or `outlook`) exactly as it does today. Since the profile is already saved, this loads correctly and shows the existing success banner — onboarding is effectively complete at that point, no further wizard screen needed.
- **On failure**: the callback's existing error redirects (`?error=no_code`, `?error=token_failed`, etc.) currently target `/artist-profile`. Since the artist hasn't seen step 5's own UI again yet in that case, step 5 needs to detect `?error=...` in the URL the same way the Artist Profile page already does, so an artist who bounces from a failed connect attempt lands back on this step (not silently on their profile page with no indication anything went wrong). On detecting an error: show a plain-language message ("That didn't work — you can try again, or connect later from your profile") and **now** reveal a "Continue without connecting for now" link. This link only appears after a real, observed failure — never shown proactively.
- Clicking "Continue without connecting for now" simply navigates to `/dashboard` (the profile is already saved; there's nothing left to do).

---

## Data Flow

1. Artist completes steps 1-4, clicks "Continue →" on step 4
2. Photo upload (non-blocking) → profile PATCH → zone save — identical logic to today's `doFinish()`, just relocated
3. On success, wizard advances to step 5 (still on `/onboarding`, no navigation yet)
4. Artist clicks "Connect Gmail" or "Connect Outlook" → full-page navigation to the existing connect route → provider's consent screen → existing callback route
5. **Success path**: callback redirects to `/artist-profile?connected=...` → profile already saved, loads normally, shows existing success banner. Onboarding is done.
6. **Failure path**: callback redirects to `/artist-profile?error=...` → step 5's logic (added to the onboarding page, not the profile page) needs to catch this before the artist-profile page's middleware/render takes over — see Open Question below.
7. If step 2 (the save itself) fails, the artist stays on step 4 with today's existing inline error — no change.

---

## Open Question for the Plan to Resolve

The callback routes redirect errors to `/artist-profile?error=...`, but step 5 lives on `/onboarding`. Two ways to make a failed connection land back on step 5's own UI (with its "continue without connecting" fallback) rather than silently showing on the Artist Profile page instead:

- **(a)** Have the Artist Profile page detect it arrived via an onboarding-originated error (e.g. a short-lived flag) and bounce back to `/onboarding` with the error preserved, or
- **(b)** Have step 5 itself poll/check connection status after returning focus, independent of the exact redirect target.

This is an implementation detail, not a product decision — the plan should pick the simpler of the two once it's being built against the real callback code.

---

## Files Touched

| File | Change |
|---|---|
| `app/onboarding/page.tsx` | Add step 5 UI; move the save call from the step-4 "finish" button to the step-4→5 transition; step 4's button relabeled "Continue →"; add error/fallback handling for a failed connection attempt |
| `app/api/auth/callback/gmail/route.ts`, `app/api/auth/callback/outlook/route.ts` | Only touched if the plan resolves the Open Question via approach (a) above — otherwise unchanged |
