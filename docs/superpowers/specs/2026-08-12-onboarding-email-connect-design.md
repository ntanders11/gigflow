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
6. **Failure path**: callback redirects to `/artist-profile?error=...` → the Artist Profile page detects the onboarding-origin cookie and redirects to `/onboarding?error=...` instead of showing its own error banner — see "Routing a Failed Connection Back to Step 5" below.
7. If step 2 (the save itself) fails, the artist stays on step 4 with today's existing inline error — no change.

---

## Routing a Failed Connection Back to Step 5

The callback routes redirect errors to `/artist-profile?error=...`, but step 5 lives on `/onboarding`. Since the connect buttons are a full-page navigation (not a popup), there's no `/onboarding` tab left open to "return to" once the browser has gone to Google/Microsoft and come back — whatever happens next has to happen on whatever page the callback actually lands on.

**Resolution**: when step 5 mounts, before the artist clicks anything, it sets a short-lived cookie (e.g. `onboarding_email_connect=1`, a few minutes' expiry, `path=/` set explicitly, default `SameSite=Lax` — not `Strict`, which would be dropped across the top-level redirect back from Google/Microsoft) via client-side JavaScript. This survives the round trip to the provider and back, since cookies are scoped to the site, not the originating page. The Artist Profile page's existing `?connected=...` / `?error=...` handling gets one small addition: if that cookie is present, clear it immediately regardless of which branch fires — and additionally, only on the `?error=...` branch, redirect to `/onboarding?error=...` instead of showing its own error banner.

Clearing the cookie on *both* outcomes (not just the error path) matters: without it, an artist who successfully connects during onboarding, then later disconnects and retries from the Connected Accounts card within the cookie's short window, would have that unrelated retry misrouted back into the onboarding wizard's failure screen if it happened to fail. The cookie's only job is to flag "the very next OAuth outcome belongs to onboarding" — once any outcome (success or failure) has been observed, it's spent and must be cleared either way.

The redirect back to `/onboarding?error=...` is a full page load, which remounts the wizard from scratch — its step state normally defaults to step 1. So on mount, the page must check the URL for `?error=...` (the same on-mount URL-param pattern the Artist Profile page already uses) and initialize directly at step 5 instead of step 1 when it's present, showing the plain-language failure message plus the "Continue without connecting for now" link. Without this, the artist would land on a blank step-1 form instead of the failure screen.

This keeps the Non-Goal above fully intact — the OAuth connect and callback routes themselves are never touched. The only addition beyond `app/onboarding/page.tsx` is a few lines in the Artist Profile page's existing error-handling to check for and act on that cookie.

---

## Files Touched

| File | Change |
|---|---|
| `app/onboarding/page.tsx` | Add step 5 UI; extend the `Step` type and the progress bar's hardcoded 4-segment/"Step X of 4" display to account for a 5th step; move the save call from step 4's "Let's go! 🎸" button *and* its "Skip for now" link (both currently call `finish()`) to the step-4→5 transition — both should save and advance to step 5, not save-and-go-to-dashboard; step 4's primary button relabeled "Continue →"; set the short-lived cookie on step 5 mount; on initial page load, check for `?error=...` in the URL and initialize directly at step 5 (not step 1) when present, showing the failure message + "Continue without connecting for now" fallback |
| `app/(protected)/artist-profile/page.tsx` | In the existing `?connected=...` / `?error=...` handling, check for the onboarding-origin cookie and clear it on either outcome; on the `?error=...` branch specifically, if the cookie was present, redirect to `/onboarding?error=...` instead of showing the profile page's own error banner |
