# Show Personal Email Connections in /api/email-status — Design

## Overview

`/api/email-status` currently reports only on the shared Resend sender's configuration (API key, verified domain). It gets extended to also report the logged-in artist's personal Gmail/Outlook connection status, since that's now part of the same underlying question — "is my email sending actually working?" — following the personal-email-OAuth feature shipped earlier.

---

## Goals

- One page to check for "why isn't my email working," covering both the shared sender and personal connections
- Plain-language output matching the existing report's style (✅/❌/⚠️ prefixed strings), not raw technical detail
- If both Gmail and Outlook are connected, clearly show which one sending will actually use right now — reusing the real send path's own selection logic, not a second copy of it that could drift out of sync
- No behavior change to actual email sending — this is read-only reporting

## Non-Goals

- No new page or UI — this stays a JSON-returning API route, visited directly, same as today
- No change to the Resend-checking logic already in the file
- No token expiry timestamps or raw scope strings in the output — status only (connected/not, healthy/needs-reconnect)
- Not building a cross-artist admin view — this reports on the logged-in user's own connections only, matching the route's existing "account owner debugging their own setup" scope and auth check

---

## What Changes

### `lib/email/send-artist-email.ts` — export `pickConnection`

The function that decides which connection wins when an artist has both Gmail and Outlook connected (prefer `status: 'active'`, then most recently updated) already exists in this file as a private helper. It's exported (along with the `EmailConnectionRow` type it operates on) so the diagnostic route can reuse the exact same logic instead of re-implementing it. This is the only change to this file — the sending behavior itself is untouched.

### `app/api/email-status/route.ts` — new section after the existing Resend checks

After the existing `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / domain-verification checks (unchanged), the route:

1. Queries `email_connections` for the logged-in user's own rows (`user_id` from the already-authenticated session — same pattern the route already uses for its login check)
2. If no rows: adds a single plain-language line noting that sending currently uses the shared StageReach address, since nothing personal is connected
3. If one or more rows exist: for each connection, adds a line showing the provider, the connected email address, and its health (`✅ active` or `⚠️ needs reconnecting — sends are falling back to the shared address`)
4. If more than one connection exists, additionally calls the newly-exported `pickConnection` (imported from `lib/email/send-artist-email.ts`) with the fetched rows and adds one line naming which provider it selected — e.g. "✅ Sending will currently use: Outlook (booking@taylorandersonmusic.com)"

All of this is additive to the existing response object — the current Resend-related keys are untouched, so nothing that already depends on this endpoint's output breaks.

---

## Example Output Shape

For an artist with both providers connected (illustrative — exact key names are an implementation detail for the plan to finalize, following the existing file's naming style):

```json
{
  "RESEND_API_KEY": "✅ set (ends in …AjcU)",
  "RESEND_FROM_EMAIL": "✅ booking@stagereach.app",
  "resend_key_valid": "✅ API key accepted by Resend",
  "verified_domains": "stagereach.app",
  "from_domain_status": "✅ stagereach.app is verified — emails will deliver to anyone",

  "personal_gmail": "✅ connected (anderson.libbyanne@gmail.com)",
  "personal_outlook": "✅ connected (booking@taylorandersonmusic.com)",
  "personal_email_active": "✅ Sending will currently use: Outlook (booking@taylorandersonmusic.com)"
}
```

For an artist with nothing connected:

```json
{
  "...existing Resend keys unchanged...": "...",
  "personal_email": "No personal Gmail/Outlook connected — sending uses the shared StageReach address"
}
```

---

## Files Touched

| File | Change |
|---|---|
| `lib/email/send-artist-email.ts` | Export `pickConnection` and `EmailConnectionRow` (currently private/unexported) — no logic change |
| `app/api/email-status/route.ts` | Add the personal-connections section described above, after the existing Resend checks |
