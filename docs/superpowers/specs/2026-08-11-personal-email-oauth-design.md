# Personal Email Sending (Gmail / Outlook OAuth) Design

## Overview

Artists can connect their own Gmail or Outlook account to StageReach. Once connected, pitch emails, manual follow-ups, and the automated 5-day follow-up cron all send from the artist's real address instead of the shared `booking@stagereach.app` Resend sender — removing the shared 100-email/day cap as a growth bottleneck and making outreach look like it's actually coming from the artist. Artists who don't connect anything keep working exactly as they do today.

---

## Goals

- Support both Gmail and Outlook as connectable personal senders
- Cover all three current sending paths: single pitch/follow-up (`/api/send-email`), batch sends (same endpoint), and the automated cron follow-up
- No artist is ever blocked from sending — if nothing is connected, or a connected account fails, email still goes out via the existing shared Resend sender
- Reuse and fix the existing (currently unused/broken) Outlook OAuth plumbing rather than building Outlook support from scratch
- One combined "Connect Outlook" step covers both calendar sync and mail sending — no separate logins

## Non-Goals

- Invoice emails (sent via Stripe's own hosted invoice emails, untouched by this work)
- Reading/syncing the artist's inbox (send-only permission — StageReach never requests read access to Gmail/Outlook mail)
- A general-purpose Settings page (this lives on the existing Artist Profile page)
- Token encryption-at-rest beyond standard database access controls (see Security note)

---

## Data Model

### New table: `email_connections`

One row per artist per provider. Stores what's needed to send on the artist's behalf and to refresh that permission when it expires.

```sql
create table email_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook')),
  connected_email text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text not null,
  status text not null default 'active' check (status in ('active', 'needs_reconnect')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table email_connections enable row level security;

create policy "Users manage their own email connections"
  on email_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

The cron follow-up job (which has no logged-in user) reads this table using the Supabase service role client, the same pattern already used in `app/api/venues/follow-up/route.ts` for reading `venues`.

Migration file: `supabase/migrations/014_email_connections.sql`

### Security note

Tokens are stored as plain columns protected by RLS (a user can only read their own row) and the service role key (used only server-side, same trust boundary as the rest of the app's service-role usage). This matches the security posture of the current cookie-based token storage — not a downgrade. Encrypting tokens at rest would be a reasonable future hardening step but isn't required for this phase.

---

## Connecting an Account

### Gmail

- New route `app/api/auth/gmail/connect/route.ts` — redirects to Google's OAuth consent screen requesting scopes `openid email https://www.googleapis.com/auth/gmail.send` (identify the connected address + send-only permission, never inbox read access)
- New route `app/api/auth/callback/gmail/route.ts` — exchanges the returned code for tokens, calls Google's userinfo endpoint to get the connected email address, and upserts a row into `email_connections` (`provider: 'gmail'`), then redirects to `/artist-profile?connected=gmail`
- Requires two new environment variables: `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` (a new OAuth client in the same Google Cloud project already used for Places/Geocoding — separate from `GOOGLE_PLACES_API_KEY`, which is a plain API key and can't be used for OAuth)

### Outlook (combined with existing calendar connection)

- `app/api/auth/outlook/connect/route.ts` is modified, not replaced: scope changes from `Calendars.ReadWrite offline_access` to `Calendars.ReadWrite Mail.Send offline_access`, and the redirect URI changes from the hardcoded `http://localhost:3000/...` to `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/outlook`. (The hardcoded localhost URI means this flow has never actually worked in production — this is a real bug fix, not just a refactor.)
- `app/api/auth/callback/outlook/route.ts` is modified: same redirect URI fix, and instead of writing tokens to cookies, it calls Microsoft Graph `/me` to get the connected mailbox address and upserts a row into `email_connections` (`provider: 'outlook'`), then redirects to `/artist-profile?connected=outlook`
- No new environment variables — reuses existing `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID`. Taylor will need to add the `Mail.Send` permission to the existing Azure app registration in the Azure portal and grant admin consent (an external one-time action, not a code change)

### Disconnecting

New route `app/api/email-connections/route.ts`:
- `GET` — returns the current user's connection(s) (provider, connected email, status) for the Artist Profile UI
- `DELETE` (`?provider=gmail|outlook`) — deletes the row. Best-effort calls the provider's token revocation endpoint first; if revocation fails, the row is still deleted (a stale token nobody can send with anymore is harmless)

---

## UI: Connected Accounts

A new card on `app/(protected)/artist-profile/page.tsx`, styled to match the existing cards (rounded-xl, `#16181c` background, same section-label treatment as "Contact Info" / "Social Links").

- Two rows, one per provider: "Gmail" and "Outlook"
- Not connected: a "Connect" button linking to `/api/auth/gmail/connect` or `/api/auth/outlook/connect`
- Connected: shows the connected email address and a "Disconnect" link
- `status: 'needs_reconnect'`: an amber inline note — "Reconnect needed — recent sends went out from your shared StageReach address instead" — with the Connect button shown again
- On page load with `?connected=gmail` or `?connected=outlook` in the URL, shows a brief success confirmation; `?error=...` shows a plain-language failure message ("Couldn't connect — please try again")

---

## Sending Flow

### Shared helper: `lib/email/send-artist-email.ts`

A single function, `sendArtistEmail({ userId, to, subject, text, html })`, used by every sending path. It:

1. Looks up the artist's `email_connections` rows (service role client, so it works identically whether called from a logged-in request or the cron job)
2. If a connection exists (preferring the most recently updated one if both Gmail and Outlook are connected): refreshes the access token first if it expires within 5 minutes, then sends via that provider's API
3. If sending succeeds, returns `{ provider: 'gmail' | 'outlook', success: true }`
4. If there's no connection, or the provider call fails for any reason: falls back to the existing Resend send (the current logic in `send-email/route.ts` moves into this helper as the fallback path) and returns `{ provider: 'resend', success: true }`
5. If the provider failure looks auth-related (401 / invalid_grant on refresh), marks that connection's `status` as `needs_reconnect` before falling back — this is what powers the warning in the Artist Profile UI

Provider-specific senders, each with a `send` and `refreshToken` function:
- `lib/email/gmail.ts` — builds a base64url-encoded raw MIME message (From header uses the artist's own address with their `artist_profiles.display_name` as the friendly name — Gmail allows this for the authenticated account) and posts to `gmail.googleapis.com/gmail/v1/users/me/messages/send`; refreshes via `oauth2.googleapis.com/token`
- `lib/email/outlook.ts` — posts to Graph `/me/sendMail`; refreshes via the Microsoft tenant token endpoint. Note: Graph's `/me/sendMail` always sends using the mailbox's own configured display name — unlike Gmail, StageReach can't override the friendly name here. This is an accepted platform limitation, not a bug to work around.

### Callers updated to use the helper

- `app/api/send-email/route.ts` — replaces its direct Resend call with `sendArtistEmail(...)`. Interaction-logging and pipeline stage-advance logic (specific to this route) stay as-is.
- `app/api/venues/follow-up/route.ts` (cron) — replaces its direct Resend call with `sendArtistEmail({ userId: venue.user_id, ... })` per venue. Everything else (eligibility query, interaction logging, `last_contacted_at` update) stays as-is.

### Calendar sync fix (byproduct)

`app/api/calendar/sync/route.ts` currently reads `outlook_access_token` straight from a cookie with no refresh logic — since Microsoft access tokens expire in about an hour but the cookie is set for 90 days, calendar sync has likely been silently broken for any session older than an hour. Since Outlook tokens are moving to the database with proper refresh handling as part of this work, this route is updated to read from `email_connections` and refresh via the same `lib/email/outlook.ts` helper — fixing that latent bug as a natural consequence, not as separate scope creep.

---

## Error Handling & Edge Cases

- **No connection at all**: sends via Resend exactly as today — zero behavior change for artists who don't opt in
- **Connected account send fails**: falls back to Resend automatically; the email still goes out. Auth-shaped failures (expired/revoked permission) flag the connection for reconnect; other failures (e.g. a transient network error) are logged but don't flag the connection, so a one-off blip doesn't force a needless reconnect
- **Both Gmail and Outlook connected**: uses whichever was connected/reconnected most recently. Not expected to be a common case, but handled deterministically rather than left ambiguous
- **OAuth callback errors** (user denies consent, code exchange fails): redirect back to `/artist-profile?error=...` with a plain-language message, no partial `email_connections` row written
- **Disconnecting**: immediate — the next send for that artist falls back to Resend (or their other connected provider, if any) with no other side effects

---

## Files Touched

| File | Change |
|---|---|
| `supabase/migrations/014_email_connections.sql` | New — `email_connections` table + RLS policy |
| `lib/email/send-artist-email.ts` | New — shared send-with-fallback helper used by every caller |
| `lib/email/gmail.ts` | New — Gmail send + token refresh |
| `lib/email/outlook.ts` | New — Outlook/Graph send + token refresh |
| `app/api/auth/gmail/connect/route.ts` | New — Gmail OAuth redirect |
| `app/api/auth/callback/gmail/route.ts` | New — Gmail OAuth callback, writes `email_connections` |
| `app/api/auth/outlook/connect/route.ts` | Modified — add `Mail.Send` scope, fix hardcoded localhost redirect URI |
| `app/api/auth/callback/outlook/route.ts` | Modified — fix redirect URI, write to `email_connections` instead of cookies |
| `app/api/email-connections/route.ts` | New — GET status / DELETE (disconnect) for the current user |
| `app/api/send-email/route.ts` | Modified — send via `sendArtistEmail()` instead of calling Resend directly |
| `app/api/venues/follow-up/route.ts` | Modified — send via `sendArtistEmail()` per venue instead of calling Resend directly |
| `app/api/calendar/sync/route.ts` | Modified — read/refresh Outlook token from `email_connections` instead of an expired cookie |
| `app/(protected)/artist-profile/page.tsx` | Modified — new "Connected Accounts" card |
| `.env.local` / Vercel env vars | Add `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` |
| `CLAUDE.md` | Updated — new table, new env vars, updated email-sending flow description |
