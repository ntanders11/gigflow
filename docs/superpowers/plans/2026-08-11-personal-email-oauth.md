# Personal Email Sending (Gmail / Outlook OAuth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let artists connect their own Gmail or Outlook account so pitch/follow-up emails send from their real address instead of the shared Resend sender, with automatic fallback to Resend if nothing is connected or a send fails.

**Architecture:** A new `email_connections` table stores OAuth tokens per artist per provider. A shared `sendArtistEmail()` helper (used by every sending path — single sends, batch sends, and the automated cron follow-up) looks up the artist's connection, refreshes the token if needed, sends via Gmail/Graph API, and falls back to Resend on any failure. The existing (currently broken/unused) Outlook calendar OAuth flow is extended to also request mail-sending permission and fixed to work in production.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), Gmail API, Microsoft Graph API, Resend (fallback only).

**No automated test suite exists in this project** (confirmed in `CLAUDE.md`: "No test suite is currently configured"). Per the skill priority rules, this project fact overrides the default TDD task structure. Every task below substitutes concrete verification steps instead: `npx tsc --noEmit`, `npx eslint <file>`, and a manual check (`curl`, Supabase SQL Editor query, or browser steps) that proves the specific behavior works.

**Two external setup steps require Taylor to act in a web console Claude cannot reach** — creating a Google OAuth client in Google Cloud Console, and adding the `Mail.Send` permission with admin consent in Azure Portal. These are called out explicitly in Tasks 6 and 7. Everything else in this plan is code Claude can write and verify directly.

---

### Task 1: Database migrations

**Files:**
- Create: `supabase/migrations/014_email_connections.sql`
- Create: `supabase/migrations/015_interactions_sent_via.sql`

- [ ] **Step 1: Write the `email_connections` migration**

```sql
-- supabase/migrations/014_email_connections.sql
--
-- Lets an artist connect their own Gmail or Outlook account so pitch/follow-up
-- emails can send from their real address instead of the shared StageReach sender.
-- One row per artist per provider. access_token/refresh_token/expires_at are
-- overwritten in place whenever the app refreshes this connection's token.

create table public.email_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  provider        text not null check (provider in ('gmail', 'outlook')),
  connected_email text not null,
  access_token    text not null,
  refresh_token   text not null,
  expires_at      timestamptz not null,
  scope           text not null,
  status          text not null default 'active' check (status in ('active', 'needs_reconnect')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, provider)
);

create index idx_email_connections_user_id on public.email_connections(user_id);

-- Reuses the update_updated_at() function defined in 001_initial_schema.sql.
-- This is what makes "most recently connected/refreshed" a reliable signal —
-- see lib/email/send-artist-email.ts.
create trigger email_connections_updated_at
  before update on public.email_connections
  for each row execute function update_updated_at();

alter table public.email_connections enable row level security;

create policy "own email connections only"
  on public.email_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 2: Write the `interactions.sent_via` migration**

```sql
-- supabase/migrations/015_interactions_sent_via.sql
--
-- Tracks which sender actually delivered an interaction's email: 'resend'
-- (shared sender), 'gmail', or 'outlook' (artist's own connected account).
-- interactions.type has no check constraint (see 012_interactions_followup_type.sql),
-- so this follows the same plain-column pattern.

alter table public.interactions
  add column if not exists sent_via text;

-- Every email ever sent before this migration went through the shared Resend
-- sender — backfill so historical rows aren't left null for no reason.
update public.interactions
  set sent_via = 'resend'
  where email_sent = true and sent_via is null;
```

- [ ] **Step 3: Run both migrations**

Open the Supabase SQL Editor (same place every prior migration in this repo was run — see the comment at the top of `001_initial_schema.sql`). Paste and run `014_email_connections.sql`, then `015_interactions_sent_via.sql`.

- [ ] **Step 4: Verify**

In the SQL Editor, run:

```sql
select column_name, data_type from information_schema.columns where table_name = 'email_connections' order by ordinal_position;
select column_name from information_schema.columns where table_name = 'interactions' and column_name = 'sent_via';
```

Expected: `email_connections` lists all 11 columns (`id`, `user_id`, `provider`, `connected_email`, `access_token`, `refresh_token`, `expires_at`, `scope`, `status`, `created_at`, `updated_at`); the second query returns one row (`sent_via`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/014_email_connections.sql supabase/migrations/015_interactions_sent_via.sql
git commit -m "feat: add email_connections table and interactions.sent_via column"
```

---

### Task 2: Types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the new types**

Add near the top of the file, after `InteractionType`:

```typescript
export type EmailProvider = "gmail" | "outlook";
export type EmailConnectionStatus = "active" | "needs_reconnect";

export interface EmailConnection {
  provider: EmailProvider;
  connected_email: string;
  status: EmailConnectionStatus;
}
```

Then update the `Interaction` interface (currently `types/index.ts:53-65`) to add `sent_via` right after `resend_id`:

```typescript
export interface Interaction {
  id: string;
  venue_id: string;
  user_id: string;
  type: InteractionType;
  notes: string | null;
  occurred_at: string;
  email_subject: string | null;
  email_body: string | null;
  email_sent: boolean;
  resend_id: string | null;
  sent_via: "resend" | "gmail" | "outlook" | null;
  created_at: string;
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: no new errors introduced (the pre-existing unrelated error surface from the stray `gigflow/gigflow` folder is expected and out of scope).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add EmailConnection type and interactions.sent_via field"
```

---

### Task 3: Gmail send/refresh library

**Files:**
- Create: `lib/email/errors.ts`
- Create: `lib/email/gmail.ts`

- [ ] **Step 1: Write a shared error type for auth-vs-transient refresh failures**

Both Google and Microsoft's OAuth token endpoints return `error: "invalid_grant"` in the response body (with an HTTP 400, not 401) specifically when a refresh token is dead — revoked, expired, or otherwise unusable. Any other failure (a 500, a network error, a rate limit) is transient and shouldn't flag a healthy connection as broken. This type carries that distinction out of `refreshToken()` so `send-artist-email.ts` can act on it correctly instead of guessing from an HTTP status code alone.

```typescript
// lib/email/errors.ts
export class TokenRefreshError extends Error {
  isAuthFailure: boolean;

  constructor(message: string, isAuthFailure: boolean) {
    super(message);
    this.name = "TokenRefreshError";
    this.isAuthFailure = isAuthFailure;
  }
}
```

- [ ] **Step 2: Write the Gmail module**

```typescript
// lib/email/gmail.ts
import { createServiceClient } from "@/lib/supabase/server";
import { TokenRefreshError } from "@/lib/email/errors";

export const GMAIL_SCOPES = "openid email https://www.googleapis.com/auth/gmail.send";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`gmail: code exchange failed (${res.status})`);
  }

  return res.json();
}

export async function fetchConnectedEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error("gmail: failed to fetch connected email");
  }

  const data = await res.json();
  return data.email;
}

export async function refreshToken(connectionId: string, refreshTokenValue: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshTokenValue,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let isAuthFailure = false;
    try {
      isAuthFailure = JSON.parse(body).error === "invalid_grant";
    } catch {
      // Non-JSON error body — treat as transient, not a dead connection.
    }
    throw new TokenRefreshError(`gmail: token refresh failed (${res.status}): ${body}`, isAuthFailure);
  }

  const tokens: TokenResponse = await res.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const supabase = await createServiceClient();
  await supabase
    .from("email_connections")
    .update({
      access_token: tokens.access_token,
      expires_at: expiresAt,
      // Google usually keeps the same refresh token across refreshes, but
      // persist a new one on the rare occasion it issues one.
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    })
    .eq("id", connectionId);

  return tokens.access_token;
}

export async function revokeGmailToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
  });
}

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}

function buildRawMessage({
  from,
  to,
  subject,
  text,
  html,
}: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): string {
  const boundary = "stagereach_boundary";
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function send({
  accessToken,
  from,
  fromName,
  to,
  subject,
  text,
  html,
}: {
  accessToken: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<
  | { success: true; providerMessageId: string }
  | { success: false; error: string; status: number }
> {
  // fromName ultimately comes from artist_profiles.display_name, which is free-text —
  // strip characters that would break a hand-built MIME header (send-email/route.ts
  // does the same sanitization; doing it here too means every caller of gmail.send
  // gets it for free, including the automated follow-up cron in Task 10).
  const safeFromName = fromName.replace(/[<>"]/g, "").trim();
  const raw = buildRawMessage({ from: `${safeFromName} <${from}>`, to, subject, text, html });

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const error = await res.text();
    return { success: false, error, status: res.status };
  }

  const data = await res.json();
  return { success: true, providerMessageId: data.id };
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npx eslint lib/email/errors.ts lib/email/gmail.ts
```

Expected: no errors. This module has no callers yet, so full behavior is verified end-to-end in Task 6 once the Gmail OAuth routes exist and Taylor has created real credentials.

- [ ] **Step 4: Commit**

```bash
git add lib/email/errors.ts lib/email/gmail.ts
git commit -m "feat: add Gmail send/refresh library"
```

---

### Task 4: Outlook send/refresh library

**Files:**
- Create: `lib/email/outlook.ts`

- [ ] **Step 1: Write the module**

```typescript
// lib/email/outlook.ts
import { createServiceClient } from "@/lib/supabase/server";
import { TokenRefreshError } from "@/lib/email/errors";

export const OUTLOOK_SCOPE = "Calendars.ReadWrite Mail.Send offline_access";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

function tokenEndpoint(): string {
  const tenantId = process.env.AZURE_TENANT_ID!;
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AZURE_CLIENT_ID!,
      client_secret: process.env.AZURE_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: OUTLOOK_SCOPE,
    }),
  });

  if (!res.ok) {
    throw new Error(`outlook: code exchange failed (${res.status})`);
  }

  return res.json();
}

export async function fetchConnectedEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error("outlook: failed to fetch connected email");
  }

  const profile = await res.json();
  return profile.mail ?? profile.userPrincipalName;
}

export async function refreshToken(connectionId: string, refreshTokenValue: string): Promise<string> {
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AZURE_CLIENT_ID!,
      client_secret: process.env.AZURE_CLIENT_SECRET!,
      refresh_token: refreshTokenValue,
      grant_type: "refresh_token",
      scope: OUTLOOK_SCOPE,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let isAuthFailure = false;
    try {
      isAuthFailure = JSON.parse(body).error === "invalid_grant";
    } catch {
      // Non-JSON error body — treat as transient, not a dead connection.
    }
    throw new TokenRefreshError(`outlook: token refresh failed (${res.status}): ${body}`, isAuthFailure);
  }

  const tokens: TokenResponse = await res.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const supabase = await createServiceClient();
  await supabase
    .from("email_connections")
    .update({
      access_token: tokens.access_token,
      expires_at: expiresAt,
      // Azure AD rotates the refresh token on nearly every use — always
      // persist the new one, or the next refresh will fail with invalid_grant.
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    })
    .eq("id", connectionId);

  return tokens.access_token;
}

export async function send({
  accessToken,
  to,
  subject,
  html,
}: {
  accessToken: string;
  to: string;
  subject: string;
  html: string;
}): Promise<
  | { success: true; providerMessageId: null }
  | { success: false; error: string; status: number }
> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    return { success: false, error, status: res.status };
  }

  // Graph's sendMail returns 202 Accepted with no body — nothing to capture.
  return { success: true, providerMessageId: null };
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint lib/email/outlook.ts
```

Expected: no errors. Full behavior verified end-to-end in Task 7.

- [ ] **Step 3: Commit**

```bash
git add lib/email/outlook.ts
git commit -m "feat: add Outlook send/refresh library"
```

---

### Task 5: Shared send-with-fallback helper

**Files:**
- Create: `lib/email/send-artist-email.ts`

- [ ] **Step 1: Write the module**

```typescript
// lib/email/send-artist-email.ts
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/server";
import * as gmail from "@/lib/email/gmail";
import * as outlook from "@/lib/email/outlook";
import { TokenRefreshError } from "@/lib/email/errors";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface SendArtistEmailParams {
  userId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  fromName: string;
  replyTo?: string;
}

interface SendArtistEmailResult {
  success: boolean;
  provider: "gmail" | "outlook" | "resend";
  providerMessageId: string | null;
  error?: string;
}

interface EmailConnectionRow {
  id: string;
  provider: "gmail" | "outlook";
  connected_email: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  status: "active" | "needs_reconnect";
  updated_at: string;
}

function pickConnection(connections: EmailConnectionRow[]): EmailConnectionRow | null {
  if (connections.length === 0) return null;
  const active = connections.filter((c) => c.status === "active");
  const pool = active.length > 0 ? active : connections;
  return pool.reduce((newest, c) =>
    new Date(c.updated_at) > new Date(newest.updated_at) ? c : newest
  );
}

async function sendViaConnection(
  connection: EmailConnectionRow,
  params: SendArtistEmailParams
): Promise<{ success: boolean; providerMessageId: string | null; authFailure: boolean; error?: string }> {
  let accessToken = connection.access_token;
  const expiresAt = new Date(connection.expires_at).getTime();

  if (expiresAt - Date.now() < REFRESH_BUFFER_MS) {
    try {
      accessToken =
        connection.provider === "gmail"
          ? await gmail.refreshToken(connection.id, connection.refresh_token)
          : await outlook.refreshToken(connection.id, connection.refresh_token);
    } catch (err) {
      // Only a genuine invalid_grant (dead/revoked refresh token) should flag
      // this connection for reconnect — a transient 500 or network blip during
      // refresh shouldn't make a healthy connection look broken.
      const authFailure = err instanceof TokenRefreshError ? err.isAuthFailure : false;
      return { success: false, providerMessageId: null, authFailure, error: `token refresh failed: ${err}` };
    }
  }

  const result =
    connection.provider === "gmail"
      ? await gmail.send({
          accessToken,
          from: connection.connected_email,
          fromName: params.fromName,
          to: params.to,
          subject: params.subject,
          text: params.text,
          html: params.html,
        })
      : await outlook.send({
          accessToken,
          to: params.to,
          subject: params.subject,
          html: params.html,
        });

  if (result.success) {
    return { success: true, providerMessageId: result.providerMessageId, authFailure: false };
  }

  return { success: false, providerMessageId: null, authFailure: result.status === 401, error: result.error };
}

async function sendViaResend(params: SendArtistEmailParams): Promise<SendArtistEmailResult> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();

  if (!apiKey) {
    console.error("send-artist-email: RESEND_API_KEY is not set");
    return { success: false, provider: "resend", providerMessageId: null, error: "Email service not configured (missing API key)" };
  }
  if (!fromEmail) {
    console.error("send-artist-email: RESEND_FROM_EMAIL is not set");
    return { success: false, provider: "resend", providerMessageId: null, error: "Email service not configured (missing from address)" };
  }

  const fromAddress = params.fromName ? `${params.fromName} <${fromEmail}>` : fromEmail;
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: fromAddress,
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });

  if (error) {
    return { success: false, provider: "resend", providerMessageId: null, error: error.message };
  }

  return { success: true, provider: "resend", providerMessageId: data?.id ?? null };
}

export async function sendArtistEmail(params: SendArtistEmailParams): Promise<SendArtistEmailResult> {
  const supabase = await createServiceClient();

  const { data: connections } = await supabase
    .from("email_connections")
    .select("id, provider, connected_email, access_token, refresh_token, expires_at, status, updated_at")
    .eq("user_id", params.userId);

  const connection = pickConnection((connections as EmailConnectionRow[]) ?? []);

  if (connection) {
    try {
      const result = await sendViaConnection(connection, params);
      if (result.success) {
        return { success: true, provider: connection.provider, providerMessageId: result.providerMessageId };
      }
      if (result.authFailure) {
        await supabase.from("email_connections").update({ status: "needs_reconnect" }).eq("id", connection.id);
      }
      console.error(
        `send-artist-email: ${connection.provider} send failed for user ${params.userId}, falling back to Resend:`,
        result.error
      );
    } catch (err) {
      console.error(
        `send-artist-email: ${connection.provider} send threw for user ${params.userId}, falling back to Resend:`,
        err
      );
    }
  }

  return sendViaResend(params);
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx eslint lib/email/send-artist-email.ts
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test of the Resend fallback path (no connection exists yet)**

Since no artist has an `email_connections` row yet at this point in the plan, every call to `sendArtistEmail()` right now must fall through to Resend — this is the path most artists will exercise until they connect an account, so it's worth confirming before wiring in the OAuth routes. This will be exercised for real in Task 9.

- [ ] **Step 4: Commit**

```bash
git add lib/email/send-artist-email.ts
git commit -m "feat: add sendArtistEmail helper with Gmail/Outlook + Resend fallback"
```

---

### Task 6: Gmail OAuth connect/callback routes

**Files:**
- Create: `app/api/auth/gmail/connect/route.ts`
- Create: `app/api/auth/callback/gmail/route.ts`
- Modify: `.env.local`

- [ ] **Step 1 — EXTERNAL, Taylor only: create a Google OAuth client**

Claude cannot create this — it requires logging into Google Cloud Console with Taylor's own account. Tell Taylor:

1. Go to Google Cloud Console → the same project used for `GOOGLE_PLACES_API_KEY` → **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**. If prompted, configure the OAuth consent screen first (External, app name "StageReach", Taylor's email as support contact).
3. Application type: **Web application**
4. Authorized redirect URIs — add both:
   - `http://localhost:3000/api/auth/callback/gmail`
   - `https://stagereach.app/api/auth/callback/gmail` (or whatever the production `NEXT_PUBLIC_APP_URL` is)
5. Under **APIs & Services → Enabled APIs**, make sure **Gmail API** is enabled for this project (search and enable it if not already).
6. Copy the generated **Client ID** and **Client Secret**.

- [ ] **Step 2: Add environment variables**

Add to `.env.local`:

```
GOOGLE_OAUTH_CLIENT_ID=<paste from Google Cloud Console>
GOOGLE_OAUTH_CLIENT_SECRET=<paste from Google Cloud Console>
```

Add the same two variables in Vercel's project settings for production (Taylor will need to do this in the Vercel dashboard — same pattern as every other env var in this project).

- [ ] **Step 3: Write the connect route**

```typescript
// app/api/auth/gmail/connect/route.ts
import { NextResponse } from "next/server";
import { GMAIL_SCOPES } from "@/lib/email/gmail";

export async function GET() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/gmail`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return NextResponse.redirect(url);
}
```

`prompt=consent` forces Google to reissue a refresh token every time — without it, a user reconnecting after a disconnect might not get one, since Google only guarantees a refresh token on first consent.

- [ ] **Step 4: Write the callback route**

```typescript
// app/api/auth/callback/gmail/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode, fetchConnectedEmail, GMAIL_SCOPES } from "@/lib/email/gmail";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/artist-profile?error=no_code", req.url));
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/gmail`;

  let tokens;
  try {
    tokens = await exchangeCode(code, redirectUri);
  } catch (err) {
    console.error("gmail callback: token exchange failed", err);
    return NextResponse.redirect(new URL("/artist-profile?error=token_failed", req.url));
  }

  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/artist-profile?error=no_refresh_token", req.url));
  }

  let connectedEmail: string;
  try {
    connectedEmail = await fetchConnectedEmail(tokens.access_token);
  } catch (err) {
    console.error("gmail callback: failed to fetch connected email", err);
    return NextResponse.redirect(new URL("/artist-profile?error=token_failed", req.url));
  }

  const { error: upsertError } = await supabase
    .from("email_connections")
    .upsert(
      {
        user_id: user.id,
        provider: "gmail",
        connected_email: connectedEmail,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scope: tokens.scope ?? GMAIL_SCOPES,
        status: "active",
      },
      { onConflict: "user_id,provider" }
    );

  if (upsertError) {
    console.error("gmail callback: failed to save connection", upsertError.message);
    return NextResponse.redirect(new URL("/artist-profile?error=save_failed", req.url));
  }

  return NextResponse.redirect(new URL("/artist-profile?connected=gmail", req.url));
}
```

- [ ] **Step 5: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint app/api/auth/gmail/connect/route.ts app/api/auth/callback/gmail/route.ts
```

- [ ] **Step 6: Manual verification (after Taylor's Google Cloud setup and Task 12's UI is in place — revisit this step then)**

While logged into StageReach locally, visit `http://localhost:3000/api/auth/gmail/connect` directly in the browser. Expected: redirected to a real Google consent screen asking to send email as the account. After approving, expected: redirected back to `/artist-profile?connected=gmail`. Confirm in the Supabase SQL Editor:

```sql
select provider, connected_email, status, expires_at from email_connections where provider = 'gmail';
```

Expected: one row with `status = 'active'` and the connected Gmail address.

- [ ] **Step 7: Commit**

```bash
git add app/api/auth/gmail/connect/route.ts app/api/auth/callback/gmail/route.ts
git commit -m "feat: add Gmail OAuth connect/callback routes"
```

(`.env.local` is gitignored and not committed — only note it in the PR description or tell Taylor directly.)

---

### Task 7: Outlook OAuth routes — add Mail.Send, fix redirect URI, move to database

**Files:**
- Modify: `app/api/auth/outlook/connect/route.ts`
- Modify: `app/api/auth/callback/outlook/route.ts`

- [ ] **Step 1 — EXTERNAL, Taylor only: update the Azure app registration**

Claude cannot do this — it requires Taylor's Azure admin login. Tell Taylor:

1. Go to the Azure Portal → **App registrations** → the existing StageReach app (the one `AZURE_CLIENT_ID` belongs to)
2. **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** → search for and add **Mail.Send**
3. Click **Grant admin consent** for the new permission
4. **Authentication** → under **Redirect URIs**, make sure both `http://localhost:3000/api/auth/callback/outlook` and the production URL (e.g. `https://stagereach.app/api/auth/callback/outlook`) are listed — add the production one if it's missing (this is the bug being fixed in this task)

- [ ] **Step 2: Replace the connect route**

```typescript
// app/api/auth/outlook/connect/route.ts
import { NextResponse } from "next/server";
import { OUTLOOK_SCOPE } from "@/lib/email/outlook";

export async function GET() {
  const clientId = process.env.AZURE_CLIENT_ID!;
  const tenantId = process.env.AZURE_TENANT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/outlook`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: OUTLOOK_SCOPE,
    prompt: "consent",
  });

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
  return NextResponse.redirect(url);
}
```

This replaces the old hardcoded `http://localhost:3000` redirect URI with `NEXT_PUBLIC_APP_URL`, and expands the scope from `Calendars.ReadWrite offline_access` to include `Mail.Send` (via the shared `OUTLOOK_SCOPE` constant from Task 4).

- [ ] **Step 3: Replace the callback route**

```typescript
// app/api/auth/callback/outlook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode, fetchConnectedEmail, OUTLOOK_SCOPE } from "@/lib/email/outlook";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/artist-profile?error=no_code", req.url));
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/outlook`;

  let tokens;
  try {
    tokens = await exchangeCode(code, redirectUri);
  } catch (err) {
    console.error("outlook callback: token exchange failed", err);
    return NextResponse.redirect(new URL("/artist-profile?error=token_failed", req.url));
  }

  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/artist-profile?error=no_refresh_token", req.url));
  }

  let connectedEmail: string;
  try {
    connectedEmail = await fetchConnectedEmail(tokens.access_token);
  } catch (err) {
    console.error("outlook callback: failed to fetch connected email", err);
    return NextResponse.redirect(new URL("/artist-profile?error=token_failed", req.url));
  }

  const { error: upsertError } = await supabase
    .from("email_connections")
    .upsert(
      {
        user_id: user.id,
        provider: "outlook",
        connected_email: connectedEmail,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scope: tokens.scope ?? OUTLOOK_SCOPE,
        status: "active",
      },
      { onConflict: "user_id,provider" }
    );

  if (upsertError) {
    console.error("outlook callback: failed to save connection", upsertError.message);
    return NextResponse.redirect(new URL("/artist-profile?error=save_failed", req.url));
  }

  return NextResponse.redirect(new URL("/artist-profile?connected=outlook", req.url));
}
```

This replaces cookie-writing with the same `email_connections` upsert pattern used for Gmail.

- [ ] **Step 4: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint app/api/auth/outlook/connect/route.ts app/api/auth/callback/outlook/route.ts
```

- [ ] **Step 5: Manual verification (after Taylor's Azure setup and Task 12's UI is in place — revisit this step then)**

Visit `http://localhost:3000/api/auth/outlook/connect` directly in the browser while logged into StageReach. Expected: a real Microsoft login/consent screen, now asking for both calendar and mail-sending permission (previously it only asked for calendar). After approving, expected: redirected to `/artist-profile?connected=outlook`. Confirm via Supabase SQL Editor:

```sql
select provider, connected_email, status, scope from email_connections where provider = 'outlook';
```

Expected: one row, `status = 'active'`, `scope` containing `Mail.Send`.

- [ ] **Step 6: Commit**

```bash
git add app/api/auth/outlook/connect/route.ts app/api/auth/callback/outlook/route.ts
git commit -m "fix: add Mail.Send scope and fix production redirect URI for Outlook OAuth"
```

---

### Task 8: Connection status API (for the Artist Profile UI)

**Files:**
- Create: `app/api/email-connections/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/email-connections/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeGmailToken } from "@/lib/email/gmail";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("email_connections")
    .select("provider, connected_email, status")
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connections: data ?? [] });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = req.nextUrl.searchParams.get("provider");
  if (provider !== "gmail" && provider !== "outlook") {
    return NextResponse.json({ error: "provider must be 'gmail' or 'outlook'" }, { status: 400 });
  }

  if (provider === "gmail") {
    const { data: connection } = await supabase
      .from("email_connections")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .maybeSingle();

    if (connection?.refresh_token) {
      // Best-effort — the row gets deleted below regardless of whether this
      // succeeds, and that's what actually stops StageReach from sending.
      await revokeGmailToken(connection.refresh_token).catch((err) =>
        console.error("email-connections DELETE: gmail revoke failed", err)
      );
    }
  }

  const { error } = await supabase
    .from("email_connections")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint app/api/email-connections/route.ts
```

- [ ] **Step 3: Manual verification**

With at least one connection from Task 6 or 7 already saved, in a browser tab logged into StageReach visit `http://localhost:3000/api/email-connections`. Expected JSON: `{"connections":[{"provider":"gmail","connected_email":"...","status":"active"}]}` (or outlook, or both). Then test disconnect with curl, substituting a real session cookie from the browser's dev tools:

```bash
curl -X DELETE "http://localhost:3000/api/email-connections?provider=gmail" -H "Cookie: <paste sb-* cookies from browser>"
```

Expected: `{"success":true}`, and re-fetching `GET /api/email-connections` no longer lists Gmail.

- [ ] **Step 4: Commit**

```bash
git add app/api/email-connections/route.ts
git commit -m "feat: add GET/DELETE /api/email-connections for managing connected accounts"
```

---

### Task 9: Switch `/api/send-email` to `sendArtistEmail()`

**Files:**
- Modify: `app/api/send-email/route.ts`

- [ ] **Step 1: Replace the Resend-specific block**

Replace the full contents of `app/api/send-email/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendArtistEmail } from "@/lib/email/send-artist-email";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { to, subject, body: emailBody, venue_id, user_id, interaction_type } = body;

  const missing = [!to && "to", !subject && "subject", !emailBody && "body", !venue_id && "venue_id"].filter(Boolean);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  // Look up artist's display name and booking email for From/Reply-To
  const { data: artistProfile } = await supabase
    .from("artist_profiles")
    .select("display_name, contact_email")
    .eq("user_id", user.id)
    .maybeSingle();

  const artistName = (artistProfile?.display_name ?? "StageReach Artist").replace(/[<>"]/g, "").trim();
  const replyToRaw = (artistProfile?.contact_email ?? user.email ?? "").trim();
  const replyTo = replyToRaw || undefined;

  // Convert plain text to HTML, making the YouTube link clickable
  const htmlBody = emailBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /(Hear it for yourself): (https?:\/\/[^\s]+)/g,
      '<a href="$2" style="color:#4a9d7a;">$1</a>'
    )
    .replace(/\n/g, "<br>");

  const sendResult = await sendArtistEmail({
    userId: user.id,
    to,
    subject,
    text: emailBody,
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${htmlBody}</div>`,
    fromName: artistName,
    replyTo,
  });

  if (!sendResult.success) {
    console.error("send-email: send failed:", sendResult.error);
    return NextResponse.json({ error: sendResult.error ?? "Failed to send email" }, { status: 500 });
  }

  console.log(`send-email: sent via ${sendResult.provider} → id=${sendResult.providerMessageId ?? "(none)"}`);

  // Log the interaction
  const { data: interaction, error: interactionError } = await supabase
    .from("interactions")
    .insert({
      venue_id,
      user_id: user_id ?? user.id,
      type: interaction_type === "follow_up" ? "follow_up" : "email",
      email_subject: subject,
      email_body: emailBody,
      email_sent: true,
      resend_id: sendResult.providerMessageId,
      sent_via: sendResult.provider,
      occurred_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (interactionError) {
    // Email was sent — log the error but don't fail the request
    console.error("Failed to log interaction:", interactionError.message);
  }

  // Update last_contacted_at, and advance stage discovered → contacted
  const { data: venueNow } = await supabase
    .from("venues")
    .select("stage")
    .eq("id", venue_id)
    .eq("user_id", user.id)
    .single();

  const stageUpdate: Record<string, string> = {
    last_contacted_at: new Date().toISOString(),
  };
  if (venueNow?.stage === "discovered") {
    stageUpdate.stage = "contacted";
  }

  await supabase
    .from("venues")
    .update(stageUpdate)
    .eq("id", venue_id)
    .eq("user_id", user.id);

  return NextResponse.json({
    success: true,
    resend_id: sendResult.providerMessageId,
    sent_via: sendResult.provider,
    interaction,
    stage: stageUpdate.stage ?? venueNow?.stage ?? null,
  });
}
```

- [ ] **Step 2: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint app/api/send-email/route.ts
```

- [ ] **Step 3: Manual verification — Resend fallback (no connection)**

Using a venue from your own pipeline that has no connected Gmail/Outlook (or temporarily using an account with none connected), send a pitch email through the normal Pipeline UI. Expected: email arrives as before, from `booking@stagereach.app`. In the Supabase SQL Editor:

```sql
select sent_via, resend_id from interactions order by created_at desc limit 1;
```

Expected: `sent_via = 'resend'`, `resend_id` populated.

- [ ] **Step 4: Manual verification — personal account (connection exists)**

With a Gmail or Outlook account connected from Task 6/7, send another pitch email through the Pipeline UI. Expected: the email arrives in the recipient's inbox from your connected address, not `booking@stagereach.app`. Check the same query — expected `sent_via = 'gmail'` or `'outlook'`.

- [ ] **Step 5: Commit**

```bash
git add app/api/send-email/route.ts
git commit -m "feat: send pitch/follow-up emails via connected Gmail/Outlook when available"
```

---

### Task 10: Switch the automated follow-up cron to `sendArtistEmail()`

**Files:**
- Modify: `app/api/venues/follow-up/route.ts`

- [ ] **Step 1: Replace the Resend-specific block**

Replace the full contents of `app/api/venues/follow-up/route.ts` with:

```typescript
// app/api/venues/follow-up/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendArtistEmail } from "@/lib/email/send-artist-email";

interface ArtistInfo {
  name: string;
  email: string;
  phone: string | null;
  website: string | null;
}

function buildFollowUpBody(venueName: string, artist: ArtistInfo): string {
  const signature = [
    artist.name,
    artist.phone,
    artist.website,
  ].filter(Boolean).join("\n");

  return `Hi there,

I wanted to follow up on my email from last week about playing at ${venueName}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.

Happy to work around your schedule. Thanks for your time!

${signature}`;
}

export async function POST(request: NextRequest) {
  // Vercel injects Authorization: Bearer <CRON_SECRET> on cron invocations
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const { data: venues, error: venueError } = await supabase
    .from("venues")
    .select("id, name, contact_email, user_id")
    .eq("stage", "contacted")
    .not("contact_email", "is", null)
    .lt("last_contacted_at", fiveDaysAgo);

  if (venueError) {
    return NextResponse.json({ error: venueError.message }, { status: 500 });
  }

  if (!venues || venues.length === 0) {
    return NextResponse.json({ sent: 0, message: "No venues need follow-up" });
  }

  const venueIds = venues.map((v) => v.id);
  const { data: existingFollowUps } = await supabase
    .from("interactions")
    .select("venue_id")
    .in("venue_id", venueIds)
    .eq("type", "follow_up");

  const alreadyFollowedUp = new Set(
    (existingFollowUps ?? []).map((i) => i.venue_id)
  );

  const eligible = venues.filter((v) => !alreadyFollowedUp.has(v.id));

  if (eligible.length === 0) {
    return NextResponse.json({ sent: 0, message: "All contacted venues already received a follow-up" });
  }

  const uniqueUserIds = [...new Set(eligible.map((v) => v.user_id))];

  const { data: artistProfiles } = await supabase
    .from("artist_profiles")
    .select("user_id, display_name, phone, social_links")
    .in("user_id", uniqueUserIds);

  const { data: profileEmails } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", uniqueUserIds);

  const artistMap = new Map<string, ArtistInfo>();
  for (const uid of uniqueUserIds) {
    const ap = artistProfiles?.find((p) => p.user_id === uid);
    const pr = profileEmails?.find((p) => p.id === uid);
    artistMap.set(uid, {
      name: ap?.display_name ?? "StageReach Artist",
      email: pr?.email ?? "",
      phone: ap?.phone ?? null,
      website: ap?.social_links?.website ?? null,
    });
  }

  const now = new Date().toISOString();
  const results: { venue: string; status: string }[] = [];

  for (const venue of eligible) {
    const artist = artistMap.get(venue.user_id)!;
    const subject = `Following up — live music inquiry for ${venue.name}`;
    const body = buildFollowUpBody(venue.name, artist);
    const htmlBody = body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#4a9d7a;">$1</a>')
      .replace(/\n/g, "<br>");

    const sendResult = await sendArtistEmail({
      userId: venue.user_id,
      to: venue.contact_email!,
      subject,
      text: body,
      html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${htmlBody}</div>`,
      fromName: artist.name,
      replyTo: artist.email || undefined,
    });

    if (!sendResult.success) {
      results.push({ venue: venue.name, status: `error: ${sendResult.error}` });
      continue;
    }

    await supabase.from("interactions").insert({
      venue_id: venue.id,
      user_id: venue.user_id,
      type: "follow_up",
      email_subject: subject,
      email_sent: true,
      resend_id: sendResult.providerMessageId,
      sent_via: sendResult.provider,
      occurred_at: now,
    });

    await supabase
      .from("venues")
      .update({ last_contacted_at: now })
      .eq("id", venue.id);

    results.push({ venue: venue.name, status: "sent" });
  }

  return NextResponse.json({
    sent: results.filter((r) => r.status === "sent").length,
    results,
  });
}
```

- [ ] **Step 2: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint app/api/venues/follow-up/route.ts
```

- [ ] **Step 3: Manual verification**

This route only fires for venues genuinely 5+ days stale, so to test it directly: pick a test venue in `contacted` stage, manually set `last_contacted_at` to 6 days ago in the Supabase SQL Editor, then call the route directly with the cron secret:

```bash
curl -X POST http://localhost:3000/api/venues/follow-up -H "Authorization: Bearer $CRON_SECRET"
```

Expected: JSON response listing that venue as `"sent"`. Confirm `sent_via` on the new interaction row matches whether that venue's artist has a connection (`gmail`/`outlook`) or not (`resend`).

- [ ] **Step 4: Commit**

```bash
git add app/api/venues/follow-up/route.ts
git commit -m "feat: send automated follow-up emails via connected Gmail/Outlook when available"
```

---

### Task 11: Fix and migrate Outlook calendar sync

**Files:**
- Modify: `app/api/calendar/sync/route.ts`

- [ ] **Step 1: Replace the cookie-based token read**

```typescript
// app/api/calendar/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshToken } from "@/lib/email/outlook";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: connection } = await supabase
    .from("email_connections")
    .select("id, access_token, refresh_token, expires_at")
    .eq("user_id", user.id)
    .eq("provider", "outlook")
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ error: "Not connected to Outlook" }, { status: 401 });
  }

  let accessToken = connection.access_token;
  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt - Date.now() < REFRESH_BUFFER_MS) {
    try {
      accessToken = await refreshToken(connection.id, connection.refresh_token);
    } catch (err) {
      console.error("calendar/sync: token refresh failed", err);
      return NextResponse.json({ error: "Not connected to Outlook" }, { status: 401 });
    }
  }

  const { venueName, city, gigDate, notes } = await req.json();

  if (!gigDate) {
    return NextResponse.json({ error: "No gig date set for this venue" }, { status: 400 });
  }

  const startDateTime = `${gigDate}T19:00:00`;
  const endDateTime = `${gigDate}T22:00:00`;

  const event = {
    subject: `Gig at ${venueName}`,
    body: {
      contentType: "Text",
      content: notes
        ? `${notes}\n\nVenue: ${venueName}${city ? `, ${city}` : ""}`
        : `Booked gig at ${venueName}${city ? `, ${city}` : ""}`,
    },
    start: { dateTime: startDateTime, timeZone: "America/Los_Angeles" },
    end: { dateTime: endDateTime, timeZone: "America/Los_Angeles" },
    location: { displayName: city ?? venueName },
  };

  const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    const err = await res.json();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const created = await res.json();
  return NextResponse.json({ id: created.id, webLink: created.webLink });
}
```

Note: `req.json()` is now called on the request body directly (unchanged from before) — this route still has no UI caller anywhere in the codebase (confirmed by grepping for `calendar/sync` across `app/` and `components/`), so this fix carries zero regression risk to existing behavior; it makes previously-nonfunctional code correct rather than changing anything a user currently relies on.

- [ ] **Step 2: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint app/api/calendar/sync/route.ts
```

- [ ] **Step 3: Manual verification**

With an Outlook connection saved from Task 7, call the route directly:

```bash
curl -X POST http://localhost:3000/api/calendar/sync \
  -H "Content-Type: application/json" \
  -H "Cookie: <paste sb-* cookies from browser>" \
  -d '{"venueName":"Test Venue","city":"Portland, OR","gigDate":"2026-09-01","notes":"test sync"}'
```

Expected: `{"id": "...", "webLink": "https://outlook.office.com/..."}`. Open `webLink` to confirm the event exists on the connected Outlook calendar.

- [ ] **Step 4: Commit**

```bash
git add app/api/calendar/sync/route.ts
git commit -m "fix: calendar sync now reads and refreshes the Outlook token from the database instead of an expired cookie"
```

---

### Task 12: Artist Profile UI — Connected Accounts card

**Files:**
- Modify: `app/(protected)/artist-profile/page.tsx`

- [ ] **Step 1: Add imports and state**

Add `EmailConnection` to the existing type import at the top of the file (currently `import { ArtistProfile, Package, VideoSample, SocialLinks } from "@/types";`):

```typescript
import { ArtistProfile, Package, VideoSample, SocialLinks, EmailConnection } from "@/types";
```

Inside the component, alongside the other `useState` declarations, add:

```typescript
  // Connected email accounts (Gmail / Outlook)
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectBanner, setConnectBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
```

- [ ] **Step 2: Load connections and handle the OAuth redirect banner**

Add a second `useEffect` (the existing one loads the profile) right after the existing one:

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
      setConnectBanner({ type: "success", message: `${connected === "gmail" ? "Gmail" : "Outlook"} connected.` });
      window.history.replaceState({}, "", "/artist-profile");
    } else if (error) {
      setConnectBanner({ type: "error", message: "Couldn't connect — please try again." });
      window.history.replaceState({}, "", "/artist-profile");
    }
  }, []);

  async function disconnectAccount(provider: "gmail" | "outlook") {
    await fetch(`/api/email-connections?provider=${provider}`, { method: "DELETE" });
    setConnections((prev) => prev.filter((c) => c.provider !== provider));
  }
```

- [ ] **Step 3: Add the card to the right-column JSX**

In the `{/* ── RIGHT MAIN CONTENT ── */}` section, insert a new card immediately after the closing `</div>` of the `{/* Contact Info */}` card and before the `{/* Bio */}` card:

```tsx
          {/* Connected Accounts */}
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div style={{ fontSize: "9px", color: "#5e5c58", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>
              Connected Accounts
            </div>
            <p style={{ color: "#9a9591", fontSize: "11px", marginBottom: "12px", lineHeight: 1.5 }}>
              Connect Gmail or Outlook to send pitch and follow-up emails from your own address instead of StageReach&apos;s shared one.
            </p>

            {connectBanner && (
              <div
                className="rounded-lg px-3 py-2 mb-3 text-xs"
                style={{
                  backgroundColor: connectBanner.type === "success" ? "rgba(76,175,125,0.12)" : "rgba(226,92,92,0.12)",
                  color: connectBanner.type === "success" ? "#4caf7d" : "#e25c5c",
                  border: `1px solid ${connectBanner.type === "success" ? "rgba(76,175,125,0.3)" : "rgba(226,92,92,0.3)"}`,
                }}
              >
                {connectBanner.message}
              </div>
            )}

            {connectionsLoading ? (
              <p style={{ color: "#5e5c58", fontSize: "11px" }}>Loading…</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(["gmail", "outlook"] as const).map((provider) => {
                  const connection = connections.find((c) => c.provider === provider);
                  const label = provider === "gmail" ? "Gmail" : "Outlook";
                  return (
                    <div
                      key={provider}
                      className="flex items-center justify-between rounded-lg px-3 py-2"
                      style={{ backgroundColor: "#1e2128" }}
                    >
                      <div>
                        <div style={{ color: "#F4E8D2", fontSize: "12px", fontWeight: 500 }}>{label}</div>
                        {connection ? (
                          <div style={{ color: "#9a9591", fontSize: "10px" }}>{connection.connected_email}</div>
                        ) : (
                          <div style={{ color: "#5e5c58", fontSize: "10px" }}>Not connected</div>
                        )}
                        {connection?.status === "needs_reconnect" && (
                          <div style={{ color: "#D4A64F", fontSize: "10px", marginTop: "2px" }}>
                            Reconnect needed — sends fell back to your shared StageReach address
                          </div>
                        )}
                      </div>
                      {connection && connection.status === "active" ? (
                        <button
                          onClick={() => disconnectAccount(provider)}
                          className="text-xs px-2.5 py-1 rounded transition-all hover:brightness-125"
                          style={{ backgroundColor: "rgba(255,255,255,0.04)", color: "#9a9591", cursor: "pointer" }}
                        >
                          Disconnect
                        </button>
                      ) : (
                        // Covers both "never connected" and "needs_reconnect" — in the
                        // latter case, clicking Connect re-runs the OAuth flow and the
                        // callback's upsert resets status back to 'active'.
                        <a
                          href={`/api/auth/${provider}/connect`}
                          className="text-xs px-2.5 py-1 rounded font-semibold transition-all hover:brightness-110 inline-block"
                          style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
                        >
                          Connect
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

```

- [ ] **Step 4: Verify types/lint**

```bash
npx tsc --noEmit && npx eslint app/\(protected\)/artist-profile/page.tsx
```

- [ ] **Step 5: Manual verification**

Visit `http://localhost:3000/artist-profile` while logged in. Expected: a new "Connected Accounts" card showing "Gmail — Not connected" and "Outlook — Not connected" with gold "Connect" buttons. Click "Connect" for Gmail — expected: redirected through Google's consent flow and back to this page with a green "Gmail connected." banner and the card now showing the connected address with a "Disconnect" link. Click "Disconnect" — expected: reverts to "Not connected" with a gold "Connect" button again.

- [ ] **Step 6: Commit**

```bash
git add "app/(protected)/artist-profile/page.tsx"
git commit -m "feat: add Connected Accounts card to Artist Profile page"
```

---

### Task 13: Update project documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md's Core Data Model section**

Add a new bullet after the `invite_codes` line:

```
- email_connections — an artist's connected Gmail or Outlook account for sending pitch/follow-up emails from their own address (provider, connected_email, tokens, status: active/needs_reconnect). One row per artist per provider.
```

- [ ] **Step 2: Update the email-sending description in Key Flows**

In the `Kanban Pipeline`, `Venue Detail`, and `Automated Follow-ups` descriptions (and anywhere else `/api/send-email` or Resend sending is described), add a note that sending now goes through `lib/email/send-artist-email.ts`, which uses the artist's connected Gmail/Outlook if present and falls back to the shared Resend sender otherwise. Add a new Key Flow entry:

```
Personal Email Sending — Artists can connect Gmail or Outlook from the Artist Profile page's "Connected Accounts" section (app/api/auth/gmail/connect, app/api/auth/callback/gmail, and the same for outlook). Once connected, all pitch/follow-up sends (manual, batch, and the automated cron) go out from the artist's real address via lib/email/send-artist-email.ts, which handles token refresh and falls back to the shared Resend sender automatically if nothing is connected or a send fails. Connections and tokens live in the email_connections table (supabase/migrations/014_email_connections.sql).
```

Update the existing Outlook Calendar Connect description to note the redirect-URI/cookie-storage fix:

```
Outlook Calendar Connect — app/api/auth/outlook/connect and app/api/auth/callback/outlook implement an Azure AD OAuth flow (now also requesting Mail.Send, shared with Personal Email Sending above) so gigs can sync to a musician's Outlook calendar via app/api/calendar/sync. Tokens are stored in the email_connections table (not cookies) so they can be refreshed server-side. app/api/calendar/ics exposes a public .ics feed as an alternative.
```

- [ ] **Step 3: Add new environment variables to the Environment Variables section**

```
- GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET — Gmail OAuth client (separate from GOOGLE_PLACES_API_KEY, which is a plain API key, not an OAuth client) for personal email sending. Created in the same Google Cloud project, under APIs & Services → Credentials.
```

- [ ] **Step 4: Add a CHANGELOG.md entry**

Add at the top of `CHANGELOG.md`, above the most recent existing entry:

```markdown
## 2026-08-11
- [Feature] Artists can now connect their own Gmail or Outlook account (Artist Profile → Connected Accounts) so pitch and follow-up emails send from their real address instead of the shared StageReach sender — removes the shared 100-email/day limit as a growth bottleneck for anyone who connects. If nothing is connected, or a connected account has a problem, sending automatically falls back to the shared sender so outreach never stops.
- [Fix] The Outlook calendar-connect flow had never actually worked in production — the redirect address was hardcoded to a local development URL. Fixed as part of rebuilding this flow to also handle email sending.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document personal email sending feature and env vars"
```

---

## Summary of external setup Taylor must do before Tasks 6/7 can be verified end-to-end

1. **Google Cloud Console** (Task 6, Step 1): create an OAuth client, enable the Gmail API, register redirect URIs, add `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` locally and in Vercel.
2. **Azure Portal** (Task 7, Step 1): add the `Mail.Send` permission to the existing app registration, grant admin consent, add the production redirect URI.

Everything else in this plan (all code, migrations, and the UI) can be written and verified (via `tsc`/`eslint`/manual DB checks) without waiting on those two steps — only the final live OAuth round-trip in Tasks 6 and 7 needs them done first.
