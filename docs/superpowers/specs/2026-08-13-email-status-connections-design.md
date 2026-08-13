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

### `lib/email/send-artist-email.ts` — export `pickConnection`, narrowed to a generic

The function that decides which connection wins when an artist has both Gmail and Outlook connected (prefer `status: 'active'`, then most recently updated) already exists in this file as a private helper, typed to take the full `EmailConnectionRow` — which includes `access_token`, `refresh_token`, and `expires_at`. Those token fields aren't actually read by `pickConnection`'s logic (only `.status` and `.updated_at` are), so exporting it as-is would force the read-only diagnostic route to select raw OAuth tokens out of the database just to satisfy the type — sensitive data a status-checking endpoint has no reason to touch.

Instead, `pickConnection` is made generic — constrained to `{ status: "active" | "needs_reconnect"; updated_at: string }` (plus whatever else a given caller's rows happen to have) — so it works unchanged for `sendArtistEmail`'s existing full-row usage, but also works for the diagnostic route's narrower query (`provider, connected_email, status, updated_at` only, no token columns). This is the only change to this file — the sending behavior itself is untouched, and `sendArtistEmail`'s own call site doesn't need to change at all.

### `app/api/email-status/route.ts` — new section after the existing Resend checks

After the existing `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / domain-verification checks (unchanged), the route:

1. Queries `email_connections` for the logged-in user's own rows, selecting only `provider, connected_email, status, updated_at` (no token columns) — `user_id` from the already-authenticated session, same pattern the route already uses for its login check
2. If no rows: adds a single plain-language line noting that sending currently uses the shared StageReach address, since nothing personal is connected
3. If one or more rows exist: for each connection, adds a line showing the provider, the connected email address, and its own health only — `✅ active` or `⚠️ needs reconnecting`. This line describes that one connection's state and must not assert anything about where sending actually falls back to, since that depends on the artist's *other* connections too (see below).
4. Separately, calls the newly-exported `pickConnection` (imported from `lib/email/send-artist-email.ts`) with the fetched rows to determine the actual outcome. `pickConnection` only returns `null` when there are zero connections — when every connection is `needs_reconnect`, it still returns the most-recently-updated one (falling back to the full set once no `active` row exists), since that's the one `sendArtistEmail` genuinely attempts next before its own fallback to Resend. So the report's outcome line must check the *status* of what's returned, not just whether something was returned:
   - If `pickConnection` returns a row **and that row's `status` is `"active"`**: one line naming which provider was selected — e.g. "✅ Sending will currently use: Outlook (booking@taylorandersonmusic.com)".
   - Otherwise — `pickConnection` returned `null` (no connections at all), **or** it returned a row whose `status` is `"needs_reconnect"` (every connection the artist has is unhealthy, so the one it picked isn't actually viable) — one line stating that sending is currently falling back to the shared StageReach address.

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

For an artist with one connection, healthy:

```json
{
  "...existing Resend keys unchanged...": "...",
  "personal_gmail": "✅ connected (artist@gmail.com)",
  "personal_email_active": "✅ Sending will currently use: Gmail (artist@gmail.com)"
}
```

For an artist with one connection that needs reconnecting (the only connection they have, so nothing is viable):

```json
{
  "...existing Resend keys unchanged...": "...",
  "personal_outlook": "⚠️ connected but needs reconnecting (artist@outlook.com)",
  "personal_email_active": "⚠️ No working personal connection — sending is currently falling back to the shared StageReach address"
}
```

For an artist with nothing connected:

```json
{
  "...existing Resend keys unchanged...": "...",
  "personal_email": "No personal Gmail/Outlook connected — sending uses the shared StageReach address"
}
```

### If the connections query itself fails

Matching the existing Resend section's pattern (which wraps its own checks in try/catch and reports a `resend_check_error` key on failure), a failure to query `email_connections` should be caught and reported the same way — e.g. a `personal_email_check_error` key — rather than left to throw and break the rest of the report.

---

## Files Touched

| File | Change |
|---|---|
| `lib/email/send-artist-email.ts` | Export `pickConnection`, made generic per above (currently private/unexported, and currently typed to the full `EmailConnectionRow`) — no logic change. `EmailConnectionRow` itself does not need exporting: the diagnostic route can define its own narrower row type (`provider`, `connected_email`, `status`, `updated_at`) that satisfies the generic constraint without importing anything token-related. |
| `app/api/email-status/route.ts` | Add the personal-connections section described above, after the existing Resend checks |
