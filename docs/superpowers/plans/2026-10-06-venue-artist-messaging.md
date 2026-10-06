# Venue/Artist In-App Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a venue start a conversation with an artist and let both sides exchange text and one image/PDF attachment per message inside StageReach, with unread badges, notifications, a block/report flow, and an email opt-out.

**Architecture:** Two new service-role-only tables (`conversations`, `messages`) plus `message_reports`, read and written only through server routes (same pattern as `booking_requests`). Shared server helpers hold the rules (who may start/send, block checks, attachment verification, notifications) so every route stays thin. Attachments go straight from the browser to a private Supabase Storage bucket through server-issued signed upload URLs (Vercel's 4.5 MB request-body limit rules out proxying 10 MB files through a route), and are verified (real file type, size, path ownership) when the message is sent. One shared `MessagesView` client component renders both the artist page and the venue page.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Storage + `@supabase/supabase-js`), Resend (email), existing `createNotification`/push helpers, Vitest (added for the pure rule helpers only).

**Spec:** `docs/superpowers/specs/2026-10-06-venue-artist-messaging-design.md`

## Global Constraints

- Only a venue can start a conversation. An artist can only reply inside an existing one. Enforced server-side.
- One conversation per (`venue_profile_id`, `artist_user_id`) pair.
- Message text max 2,000 characters; a message needs text, an attachment, or both.
- One attachment per message: JPEG, PNG, WebP, GIF, or PDF, max 10 MB (10,485,760 bytes). Real file type verified by content, not extension.
- Attachments live in a **private** bucket `message-attachments`; downloads only via short-lived signed URLs, only to the two participants.
- Messaging tables have RLS enabled with **no policies**; all access via the service-role client after the caller is verified (see CLAUDE.md "Supabase Clients").
- The new migration must end with the three standard grants (`anon`, `authenticated`, `service_role`) for every new table (CLAUDE.md "Data API Grants").
- In-app notification + push on every new message always; the **email** is sent only for the first unread message in a thread and is skipped when `profiles.message_emails_enabled` is false. The opt-out toggle never affects in-app or push alerts.
- Venue mobile bottom bar: Dashboard, Discover, Bookings, **Messages** (replaces Invoices), Profile. Venue desktop top bar keeps Invoices and adds Messages. Artist mobile bar stays at 5 tabs (no Messages tab).
- Use the existing dark theme tokens inline (`#0E0E10` page, `#16181c` cards, `#D4A64F` gold, `#F4E8D2` cream, `#9a9591` muted). Each venue page's outer container carries `pb-28 md:pb-0`; headers on mobile carry `pr-14 md:pr-0` to clear the fixed bell.
- Plain-language copy (Taylor is non-technical). Migrations are numbered; the next is `030`.

## File Structure

**Create**
- `vitest.config.ts` — test runner config (alias `@/`).
- `lib/messages/rules.ts` — pure constants + validators (text, attachment declaration, file-type sniffing, filename sanitizing, block messages). Safe to import from client code.
- `lib/messages/rules.test.ts` — tests for the above.
- `supabase/migrations/030_messaging.sql` — tables, bucket, preference column, widened notification types, grants.
- `lib/messages/access.ts` — `getParticipant`, `loadOwnConversation`, types.
- `lib/messages/threads.ts` — builds conversation list and thread views (counterparts, unread, signed URLs, marks read).
- `lib/messages/send.ts` — `sendMessage` shared by "start conversation" and "send message".
- `lib/messages/notify.ts` — in-app/push notification + email decision.
- `lib/messages/unread.ts` — `countUnreadMessages`.
- `lib/email/message-notifications.ts` — the "new message" email.
- `app/api/messages/conversations/route.ts` — list + create.
- `app/api/messages/conversations/[id]/route.ts` — thread read.
- `app/api/messages/conversations/[id]/messages/route.ts` — send.
- `app/api/messages/conversations/[id]/attachments/route.ts` — signed upload URL.
- `app/api/messages/conversations/[id]/block/route.ts` — block / unblock.
- `app/api/messages/conversations/[id]/report/route.ts` — report a message.
- `app/api/messages/unread-count/route.ts`
- `app/api/messages/preferences/route.ts`
- `components/messages/MessagesView.tsx` — shared list + thread UI.
- `components/messages/MessageArtistButton.tsx` — venue-only button on artist public profile.
- `components/messages/MessageEmailToggle.tsx` — "Email me about new messages".
- `app/(protected)/messages/page.tsx` — artist page.
- `app/venue/messages/page.tsx` — venue page.

**Modify**
- `package.json` — `vitest` dev dependency + `test` script.
- `types/index.ts` — `NotificationType` + message view types.
- `lib/notifications/create.ts` — add `message_received` (and `gig_reminder` is already there) to `PUSHABLE_TYPES`.
- `components/venue/VenueNav.tsx` — Messages tab with badge; Invoices becomes desktop-only.
- `app/venue/dashboard/page.tsx` — "Unread Messages" stat card.
- `app/(protected)/dashboard/page.tsx` — "Unread Messages" stat card.
- `app/profile/[id]/page.tsx` — message button for venue viewers.
- `app/(protected)/artist-profile/page.tsx`, `app/venue/profile/page.tsx` — email toggle beside `PushToggle`.
- `CLAUDE.md`, `CHANGELOG.md` — docs.

**Spec adjustments made by this plan** (apply to the spec in Task 1's commit): (1) attachment upload is a signed-URL flow, not a file POST; (2) the `message-attachments` bucket is created by the migration, not by hand; (3) the pinned booking request is looked up at read time, so `conversations` has no `booking_request_id` column; (4) the email preference is one column on `profiles` for everyone, saved via `/api/messages/preferences`, not the two profile PATCH routes; (5) an "unblock" action exists for the person who blocked; (6) while a conversation is blocked, neither side can send.

**Heads-up found while planning:** `gig_reminder` is used by the code (`lib/notifications/create.ts`, the reminder cron) but is **not** in the `notifications.type` check constraint from migrations 023/024, so those notification rows currently fail to insert (the push still goes out). Migration 030 widens the constraint to include it, fixing that as a side effect.

---

### Task 1: Test runner and pure message rules

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `lib/messages/rules.ts`
- Test: `lib/messages/rules.test.ts`
- Modify: `docs/superpowers/specs/2026-10-06-venue-artist-messaging-design.md` (apply the six adjustments above)

**Interfaces:**
- Produces (used by every later task):
  - `MESSAGE_BUCKET = "message-attachments"`, `MAX_BODY_LENGTH = 2000`, `MAX_ATTACHMENT_BYTES = 10485760`
  - `ALLOWED_ATTACHMENT_TYPES: readonly string[]`
  - `sanitizeFileName(name: string): string`
  - `validateMessageInput(body: unknown, hasAttachment: boolean): { ok: true; body: string } | { ok: false; error: string }`
  - `validateAttachmentDeclaration(type: string, size: number): { ok: true } | { ok: false; error: string }`
  - `sniffAttachmentType(bytes: Uint8Array): string | null`
  - `blockedSendError(blockedBy: "artist" | "venue" | null, myRole: "artist" | "venue"): string | null`

- [ ] **Step 1: Install Vitest and add the script**

Run: `cd /Users/tayloranderson/gigflow && npm install --save-dev vitest`

Then in `package.json` add to `"scripts"`: `"test": "vitest run"`.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { include: ["lib/**/*.test.ts"] },
});
```

- [ ] **Step 3: Write the failing tests** — `lib/messages/rules.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  MAX_BODY_LENGTH,
  MAX_ATTACHMENT_BYTES,
  sanitizeFileName,
  validateMessageInput,
  validateAttachmentDeclaration,
  sniffAttachmentType,
  blockedSendError,
} from "@/lib/messages/rules";

describe("sanitizeFileName", () => {
  it("strips directories", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
  });
  it("replaces unsafe characters but keeps the extension", () => {
    expect(sanitizeFileName("stage plot (v2).pdf")).toBe("stage_plot_v2_.pdf");
  });
  it("never returns an empty name", () => {
    expect(sanitizeFileName("...")).toBe("file");
  });
  it("keeps the tail of very long names so the extension survives", () => {
    const name = "a".repeat(200) + ".png";
    const out = sanitizeFileName(name);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith(".png")).toBe(true);
  });
});

describe("validateMessageInput", () => {
  it("trims text", () => {
    expect(validateMessageInput("  hi  ", false)).toEqual({ ok: true, body: "hi" });
  });
  it("rejects empty text with no attachment", () => {
    expect(validateMessageInput("   ", false).ok).toBe(false);
    expect(validateMessageInput(undefined, false).ok).toBe(false);
  });
  it("allows empty text when there is an attachment", () => {
    expect(validateMessageInput("", true)).toEqual({ ok: true, body: "" });
    expect(validateMessageInput(undefined, true)).toEqual({ ok: true, body: "" });
  });
  it("rejects non-string text", () => {
    expect(validateMessageInput(42, false).ok).toBe(false);
  });
  it("rejects text over the limit", () => {
    expect(validateMessageInput("a".repeat(MAX_BODY_LENGTH + 1), false).ok).toBe(false);
    expect(validateMessageInput("a".repeat(MAX_BODY_LENGTH), false).ok).toBe(true);
  });
});

describe("validateAttachmentDeclaration", () => {
  it("accepts allowed types at the size limit", () => {
    expect(validateAttachmentDeclaration("application/pdf", MAX_ATTACHMENT_BYTES).ok).toBe(true);
    expect(validateAttachmentDeclaration("image/png", 1000).ok).toBe(true);
  });
  it("rejects other types", () => {
    expect(validateAttachmentDeclaration("application/zip", 1000).ok).toBe(false);
    expect(validateAttachmentDeclaration("audio/mpeg", 1000).ok).toBe(false);
  });
  it("rejects oversized and empty files", () => {
    expect(validateAttachmentDeclaration("image/png", MAX_ATTACHMENT_BYTES + 1).ok).toBe(false);
    expect(validateAttachmentDeclaration("image/png", 0).ok).toBe(false);
  });
});

describe("sniffAttachmentType", () => {
  it("recognizes PDF", () => {
    expect(sniffAttachmentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
  });
  it("recognizes PNG", () => {
    expect(sniffAttachmentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
  });
  it("recognizes JPEG", () => {
    expect(sniffAttachmentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });
  it("recognizes GIF", () => {
    expect(sniffAttachmentType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
  });
  it("recognizes WebP", () => {
    const b = new Uint8Array(12);
    b.set([0x52, 0x49, 0x46, 0x46], 0);
    b.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffAttachmentType(b)).toBe("image/webp");
  });
  it("returns null for anything else", () => {
    expect(sniffAttachmentType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // Windows .exe
    expect(sniffAttachmentType(new Uint8Array([]))).toBeNull();
  });
});

describe("blockedSendError", () => {
  it("returns null when nobody is blocked", () => {
    expect(blockedSendError(null, "venue")).toBeNull();
  });
  it("tells the blocker how to continue", () => {
    expect(blockedSendError("venue", "venue")).toMatch(/unblock/i);
  });
  it("gives the blocked side a neutral message", () => {
    const msg = blockedSendError("venue", "artist");
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/blocked/i);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd /Users/tayloranderson/gigflow && npm test`
Expected: FAIL — cannot find module `@/lib/messages/rules`.

- [ ] **Step 5: Implement** — `lib/messages/rules.ts`

```ts
// lib/messages/rules.ts
// Pure rules for messaging — no server or database imports, so both the
// API routes and the browser UI can use the exact same limits.

export const MESSAGE_BUCKET = "message-attachments";
export const MAX_BODY_LENGTH = 2000;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return cleaned || "file";
}

export function validateMessageInput(body: unknown, hasAttachment: boolean): Result<{ body: string }> {
  if (body !== undefined && body !== null && typeof body !== "string") {
    return { ok: false, error: "Message must be text." };
  }
  const text = (body ?? "").toString().trim();
  if (text.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `Messages can be up to ${MAX_BODY_LENGTH.toLocaleString("en-US")} characters.` };
  }
  if (!text && !hasAttachment) {
    return { ok: false, error: "Write a message or attach a file." };
  }
  return { ok: true, body: text };
}

export function validateAttachmentDeclaration(type: string, size: number): Result {
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: "Only images (JPEG, PNG, WebP, GIF) and PDFs can be attached." };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "That file looks empty." };
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "Files can be up to 10 MB." };
  }
  return { ok: true };
}

// Looks at the first bytes of a file to decide what it really is, so a
// renamed file can't sneak past the allowed-types list.
export function sniffAttachmentType(bytes: Uint8Array): string | null {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (bytes.length >= 4 && starts([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (bytes.length >= 8 && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 3 && starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 6 && starts([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (bytes.length >= 12 && starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export function blockedSendError(
  blockedBy: "artist" | "venue" | null,
  myRole: "artist" | "venue"
): string | null {
  if (!blockedBy) return null;
  if (blockedBy === myRole) return "You've blocked this conversation. Unblock it to send messages.";
  return "You can't send messages in this conversation.";
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd /Users/tayloranderson/gigflow && npm test`
Expected: all tests PASS.

- [ ] **Step 7: Apply the six spec adjustments**

Edit the spec so it matches the plan header's "Spec adjustments" list (upload flow, bucket in migration, no `booking_request_id` column, preference column on `profiles` + `/api/messages/preferences`, unblock action, send blocked for both sides while blocked).

- [ ] **Step 8: Commit**

```bash
cd /Users/tayloranderson/gigflow
git add package.json package-lock.json vitest.config.ts lib/messages docs/superpowers/specs
git commit -m "feat: messaging rules (text/attachment limits, file sniffing) with tests

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Database migration, bucket, and shared types

**Files:**
- Create: `supabase/migrations/030_messaging.sql`
- Modify: `types/index.ts` (after the `NotificationType` block, ~line 369–381), `lib/notifications/create.ts:5-16`

**Interfaces:**
- Produces: tables `conversations`, `messages`, `message_reports`; column `profiles.message_emails_enabled`; storage bucket `message-attachments`; TS types `MessageSenderRole`, `ConversationView`, `MessageView`, `ThreadView`; `NotificationType` includes `"message_received"`.

- [ ] **Step 1: Write the migration** — `supabase/migrations/030_messaging.sql`

```sql
-- supabase/migrations/030_messaging.sql
-- In-app messaging between venues and artists.
-- conversations / messages / message_reports have RLS enabled with NO
-- policies: every read/write goes through a server route using the
-- service-role client after the caller is verified (same pattern as
-- booking_requests and venue_artist_ratings).

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  venue_profile_id uuid not null references public.venue_profiles(id) on delete cascade,
  artist_user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_by text check (blocked_by in ('artist', 'venue')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (venue_profile_id, artist_user_id)
);
create index idx_conversations_artist on public.conversations (artist_user_id, last_message_at desc);
create index idx_conversations_venue on public.conversations (venue_profile_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('artist', 'venue')),
  sender_user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size integer,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or attachment_path is not null)
);
create index idx_messages_conversation on public.messages (conversation_id, created_at);
create index idx_messages_unread on public.messages (conversation_id, sender_type) where read_at is null;

create table public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_reports enable row level security;

-- Email opt-out for "new message" emails. One column on profiles covers
-- both artist and venue logins (every account has a profiles row).
alter table public.profiles
  add column message_emails_enabled boolean not null default true;

-- Widen the notification types. Also adds gig_reminder, which the code
-- already uses but earlier constraints (023/024) never allowed.
alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent',
    'booking_cancelled_by_venue', 'booking_cancelled_by_artist',
    'booking_rescheduled', 'gig_reminder', 'message_received'
  ));

-- Private bucket for message attachments. No storage policies are created
-- on purpose: only the service role (and signed URLs it issues) can touch
-- these files. Bucket-level limits are a second line of defense on top of
-- the server-side checks in lib/messages/send.ts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments', 'message-attachments', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do nothing;

grant select on public.conversations to anon;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.conversations to service_role;

grant select on public.messages to anon;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.messages to service_role;

grant select on public.message_reports to anon;
grant select, insert, update, delete on public.message_reports to authenticated;
grant select, insert, update, delete on public.message_reports to service_role;
```

- [ ] **Step 2: Add types** — in `types/index.ts`, add `| "message_received"` to `NotificationType` (after `| "gig_reminder"`), then append:

```ts
// ============================================================
// MESSAGING
// ============================================================

export type MessageSenderRole = "artist" | "venue";

export interface ConversationView {
  id: string;
  counterpart_name: string;
  counterpart_photo_url: string | null;
  counterpart_href: string;
  last_message_preview: string;
  last_message_at: string;
  unread_count: number;
  blocked: boolean;
}

export interface MessageView {
  id: string;
  mine: boolean;
  body: string;
  created_at: string;
  attachment: { name: string; type: string; size: number; url: string } | null;
}

export interface ThreadView {
  conversation: ConversationView;
  messages: MessageView[];
  blocked_by_me: boolean;
  booking: { date: string; status: string } | null;
}
```

- [ ] **Step 3: Make `message_received` pushable** — in `lib/notifications/create.ts`, add inside `PUSHABLE_TYPES` after `"gig_reminder",`:

```ts
  // A person is waiting on a reply — worth a phone alert.
  "message_received",
```

- [ ] **Step 4: Type-check**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Apply the migration (Taylor)**

Ask Taylor to paste `030_messaging.sql` into the Supabase SQL Editor and run it (the way earlier migrations were applied), then confirm: Table Editor shows `conversations`, `messages`, `message_reports`; Storage shows a private `message-attachments` bucket. **Do not continue to Task 3's manual verification until this is done** (code can still be written and type-checked).

- [ ] **Step 6: Commit**

```bash
cd /Users/tayloranderson/gigflow
git add supabase/migrations/030_messaging.sql types/index.ts lib/notifications/create.ts
git commit -m "feat: messaging tables, private attachments bucket, message_received type

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server helpers (access, threads, send, notify, unread)

**Files:**
- Create: `lib/messages/access.ts`, `lib/messages/threads.ts`, `lib/messages/send.ts`, `lib/messages/notify.ts`, `lib/messages/unread.ts`, `lib/email/message-notifications.ts`

**Interfaces:**
- Consumes: Task 1 rules; Task 2 types/tables; `createNotification(service, {userId, type, title, body?, link})` from `lib/notifications/create.ts`.
- Produces:
  - `type Participant = { role: "venue"; userId: string; venueProfileId: string } | { role: "artist"; userId: string }`
  - `type ConversationRow = { id: string; venue_profile_id: string; artist_user_id: string; blocked_by: "artist" | "venue" | null; last_message_at: string; created_at: string }`
  - `getParticipant(supabase: SupabaseClient, userId: string): Promise<Participant | null>`
  - `loadOwnConversation(service: SupabaseClient, p: Participant, conversationId: string): Promise<ConversationRow | null>`
  - `buildConversationViews(service, p, rows: ConversationRow[]): Promise<ConversationView[]>`
  - `buildThread(service, p, conversation: ConversationRow): Promise<ThreadView>` (also marks the other side's messages read)
  - `type AttachmentInput = { path: string; name: string; type: string; size: number }`
  - `sendMessage(service, args: { conversation: ConversationRow; participant: Participant; body: unknown; attachment?: AttachmentInput | null }): Promise<{ ok: true; messageId: string } | { ok: false; status: number; error: string }>`
  - `countUnreadMessages(service, p: Participant): Promise<number>`

- [ ] **Step 1: `lib/messages/access.ts`**

```ts
// lib/messages/access.ts
import { SupabaseClient } from "@supabase/supabase-js";

export type Participant =
  | { role: "venue"; userId: string; venueProfileId: string }
  | { role: "artist"; userId: string };

export type ConversationRow = {
  id: string;
  venue_profile_id: string;
  artist_user_id: string;
  blocked_by: "artist" | "venue" | null;
  last_message_at: string;
  created_at: string;
};

// Works out which kind of account is calling. A venue must have finished
// signup (venue_name set); an artist must have finished onboarding
// (display_name set). Pass the RLS-scoped client — both tables let a user
// read their own row.
export async function getParticipant(
  supabase: SupabaseClient,
  userId: string
): Promise<Participant | null> {
  const { data: venue } = await supabase
    .from("venue_profiles")
    .select("id, venue_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (venue) {
    return venue.venue_name
      ? { role: "venue", userId, venueProfileId: venue.id as string }
      : null;
  }
  const { data: artist } = await supabase
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  return artist?.display_name ? { role: "artist", userId } : null;
}

// Returns the conversation only if the caller is one of its two people.
// A non-member gets null (callers answer 404, so nobody can probe whether
// a conversation id exists).
export async function loadOwnConversation(
  service: SupabaseClient,
  participant: Participant,
  conversationId: string
): Promise<ConversationRow | null> {
  const { data } = await service
    .from("conversations")
    .select("id, venue_profile_id, artist_user_id, blocked_by, last_message_at, created_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) return null;
  const mine =
    participant.role === "venue"
      ? data.venue_profile_id === participant.venueProfileId
      : data.artist_user_id === participant.userId;
  return mine ? (data as ConversationRow) : null;
}
```

- [ ] **Step 2: `lib/messages/unread.ts`**

```ts
// lib/messages/unread.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { Participant } from "@/lib/messages/access";

// Messages sent by the other side that this person hasn't opened yet.
export async function countUnreadMessages(
  service: SupabaseClient,
  participant: Participant
): Promise<number> {
  const column = participant.role === "venue" ? "venue_profile_id" : "artist_user_id";
  const value = participant.role === "venue" ? participant.venueProfileId : participant.userId;

  const { data: convs } = await service.from("conversations").select("id").eq(column, value);
  const ids = (convs ?? []).map((c) => c.id as string);
  if (ids.length === 0) return 0;

  const { count } = await service
    .from("messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", ids)
    .neq("sender_type", participant.role)
    .is("read_at", null);
  return count ?? 0;
}
```

- [ ] **Step 3: `lib/messages/threads.ts`**

```ts
// lib/messages/threads.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { MESSAGE_BUCKET } from "@/lib/messages/rules";
import { ConversationRow, Participant } from "@/lib/messages/access";
import { ConversationView, MessageView, ThreadView } from "@/types";

type Counterpart = { name: string; photo: string | null; href: string };

async function loadCounterparts(
  service: SupabaseClient,
  participant: Participant,
  rows: ConversationRow[]
): Promise<Map<string, Counterpart>> {
  const out = new Map<string, Counterpart>();
  if (rows.length === 0) return out;

  if (participant.role === "artist") {
    const ids = [...new Set(rows.map((r) => r.venue_profile_id))];
    const { data } = await service.from("venue_profiles").select("id, venue_name, photo_url").in("id", ids);
    const byId = new Map((data ?? []).map((v) => [v.id as string, v]));
    for (const r of rows) {
      const v = byId.get(r.venue_profile_id);
      out.set(r.id, {
        name: (v?.venue_name as string | null) ?? "A venue",
        photo: (v?.photo_url as string | null) ?? null,
        href: `/venues/profile/${r.venue_profile_id}`,
      });
    }
  } else {
    const ids = [...new Set(rows.map((r) => r.artist_user_id))];
    const { data } = await service.from("artist_profiles").select("user_id, display_name, photo_url").in("user_id", ids);
    const byId = new Map((data ?? []).map((a) => [a.user_id as string, a]));
    for (const r of rows) {
      const a = byId.get(r.artist_user_id);
      out.set(r.id, {
        name: (a?.display_name as string | null) ?? "An artist",
        photo: (a?.photo_url as string | null) ?? null,
        href: `/profile/${r.artist_user_id}`,
      });
    }
  }
  return out;
}

function previewOf(body: string, attachmentName: string | null): string {
  const text = body.trim();
  if (text) return text.length > 80 ? text.slice(0, 80) + "…" : text;
  return attachmentName ? `Attachment: ${attachmentName}` : "";
}

export async function buildConversationViews(
  service: SupabaseClient,
  participant: Participant,
  rows: ConversationRow[]
): Promise<ConversationView[]> {
  if (rows.length === 0) return [];
  const counterparts = await loadCounterparts(service, participant, rows);

  // One query for every conversation's recent messages; last message and
  // unread count are worked out in JS. Capped at 1,000 rows — plenty for
  // the beta; revisit with per-conversation queries if it ever isn't.
  const { data: msgs } = await service
    .from("messages")
    .select("conversation_id, sender_type, body, attachment_name, created_at, read_at")
    .in("conversation_id", rows.map((r) => r.id))
    .order("created_at", { ascending: false })
    .limit(1000);

  const last = new Map<string, { body: string; attachment_name: string | null }>();
  const unread = new Map<string, number>();
  for (const m of msgs ?? []) {
    const cid = m.conversation_id as string;
    if (!last.has(cid)) last.set(cid, { body: m.body as string, attachment_name: m.attachment_name as string | null });
    if (m.sender_type !== participant.role && !m.read_at) unread.set(cid, (unread.get(cid) ?? 0) + 1);
  }

  return rows.map((r): ConversationView => {
    const c = counterparts.get(r.id);
    const l = last.get(r.id);
    return {
      id: r.id,
      counterpart_name: c?.name ?? "Unknown",
      counterpart_photo_url: c?.photo ?? null,
      counterpart_href: c?.href ?? "#",
      last_message_preview: l ? previewOf(l.body, l.attachment_name) : "",
      last_message_at: r.last_message_at,
      unread_count: unread.get(r.id) ?? 0,
      blocked: !!r.blocked_by,
    };
  });
}

export async function buildThread(
  service: SupabaseClient,
  participant: Participant,
  conversation: ConversationRow
): Promise<ThreadView> {
  // Opening a thread marks the other side's messages as read.
  await service
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversation.id)
    .neq("sender_type", participant.role)
    .is("read_at", null);

  const { data: rows } = await service
    .from("messages")
    .select("id, sender_type, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .limit(500);

  const paths = (rows ?? []).map((m) => m.attachment_path as string | null).filter((p): p is string => !!p);
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await service.storage.from(MESSAGE_BUCKET).createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  const messages: MessageView[] = (rows ?? []).map((m) => {
    const path = m.attachment_path as string | null;
    const url = path ? urlByPath.get(path) : undefined;
    return {
      id: m.id as string,
      mine: m.sender_type === participant.role,
      body: m.body as string,
      created_at: m.created_at as string,
      attachment:
        path && url
          ? { name: m.attachment_name as string, type: m.attachment_type as string, size: m.attachment_size as number, url }
          : null,
    };
  });

  const [view] = await buildConversationViews(service, participant, [conversation]);

  // The most relevant booking request between this pair, shown pinned at
  // the top of the thread. Looked up on read, not stored.
  const { data: booking } = await service
    .from("booking_requests")
    .select("date, status")
    .eq("venue_profile_id", conversation.venue_profile_id)
    .eq("artist_user_id", conversation.artist_user_id)
    .in("status", ["pending", "accepted"])
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    conversation: { ...view, unread_count: 0 },
    messages,
    blocked_by_me: conversation.blocked_by === participant.role,
    booking: booking ? { date: booking.date as string, status: booking.status as string } : null,
  };
}
```

- [ ] **Step 4: `lib/email/message-notifications.ts`**

```ts
// lib/email/message-notifications.ts
import { Resend } from "resend";
import { SupabaseClient } from "@supabase/supabase-js";

async function sendSystemEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail) {
    console.error("message-notifications: Resend not configured (missing API key or from address)");
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from: `StageReach <${fromEmail}>`, to, subject, text });
  if (error) console.error("message-notifications: send failed", error);
}

// Sent for the first unread message in a thread only (the caller decides),
// and skipped when the recipient turned message emails off.
export async function sendNewMessageEmail(
  service: SupabaseClient,
  recipientUserId: string,
  senderName: string,
  link: string
): Promise<void> {
  const { data: profile, error } = await service
    .from("profiles")
    .select("email, message_emails_enabled")
    .eq("id", recipientUserId)
    .maybeSingle();
  if (error) console.error("sendNewMessageEmail: profile lookup failed", error);
  if (!profile?.email || profile.message_emails_enabled === false) return;

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  await sendSystemEmail(
    profile.email as string,
    `${senderName} sent you a message on StageReach`,
    `${senderName} sent you a message on StageReach. Open it here: ${base}${link}\n\nYou can turn these emails off from your profile page.`
  );
}
```

- [ ] **Step 5: `lib/messages/notify.ts`**

```ts
// lib/messages/notify.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { createNotification } from "@/lib/notifications/create";
import { sendNewMessageEmail } from "@/lib/email/message-notifications";
import { ConversationRow } from "@/lib/messages/access";

// Always creates the in-app notification (+ push). Only emails when this
// is the first unread message in the thread. Never throws.
export async function notifyNewMessage(
  service: SupabaseClient,
  params: {
    conversation: ConversationRow;
    senderRole: "artist" | "venue";
    preview: string;
    emailFirstUnread: boolean;
  }
): Promise<void> {
  try {
    const { conversation, senderRole, preview, emailFirstUnread } = params;
    let recipientUserId: string | null = null;
    let senderName = "Someone";
    let link = "";

    if (senderRole === "venue") {
      recipientUserId = conversation.artist_user_id;
      link = `/messages?c=${conversation.id}`;
      const { data } = await service.from("venue_profiles").select("venue_name").eq("id", conversation.venue_profile_id).maybeSingle();
      senderName = (data?.venue_name as string | null) ?? "A venue";
    } else {
      link = `/venue/messages?c=${conversation.id}`;
      const { data: venue } = await service.from("venue_profiles").select("user_id").eq("id", conversation.venue_profile_id).maybeSingle();
      recipientUserId = (venue?.user_id as string | null) ?? null;
      const { data: artist } = await service.from("artist_profiles").select("display_name").eq("user_id", conversation.artist_user_id).maybeSingle();
      senderName = (artist?.display_name as string | null) ?? "An artist";
    }
    if (!recipientUserId) return;

    await createNotification(service, {
      userId: recipientUserId,
      type: "message_received",
      title: `New message from ${senderName}`,
      body: preview,
      link,
    });

    if (emailFirstUnread) await sendNewMessageEmail(service, recipientUserId, senderName, link);
  } catch (err) {
    console.error("notifyNewMessage failed", err);
  }
}
```

- [ ] **Step 6: `lib/messages/send.ts`**

```ts
// lib/messages/send.ts
import { SupabaseClient } from "@supabase/supabase-js";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MESSAGE_BUCKET,
  blockedSendError,
  sniffAttachmentType,
  validateMessageInput,
} from "@/lib/messages/rules";
import { ConversationRow, Participant } from "@/lib/messages/access";
import { notifyNewMessage } from "@/lib/messages/notify";

export type AttachmentInput = { path: string; name: string; type: string; size: number };

type SendResult = { ok: true; messageId: string } | { ok: false; status: number; error: string };

// Shared by "venue starts a conversation with a first message" and
// "send a message in an existing conversation", so the block check, text
// and attachment validation, and notifications can't drift apart.
export async function sendMessage(
  service: SupabaseClient,
  args: {
    conversation: ConversationRow;
    participant: Participant;
    body: unknown;
    attachment?: AttachmentInput | null;
  }
): Promise<SendResult> {
  const { conversation, participant, attachment } = args;

  const blocked = blockedSendError(conversation.blocked_by, participant.role);
  if (blocked) return { ok: false, status: 403, error: blocked };

  const text = validateMessageInput(args.body, !!attachment);
  if (!text.ok) return { ok: false, status: 400, error: text.error };

  let verified: { path: string; name: string; type: string; size: number } | null = null;
  if (attachment) {
    // The path must be one this conversation's own upload route issued.
    if (typeof attachment.path !== "string" || !attachment.path.startsWith(`${conversation.id}/`) || attachment.path.includes("..")) {
      return { ok: false, status: 400, error: "That attachment isn't valid." };
    }
    const { data: blob, error: dlError } = await service.storage.from(MESSAGE_BUCKET).download(attachment.path);
    if (dlError || !blob) return { ok: false, status: 400, error: "We couldn't find that upload. Try attaching it again." };

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const realType = sniffAttachmentType(bytes);
    const tooBig = bytes.length > MAX_ATTACHMENT_BYTES;
    if (!realType || !(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(realType) || tooBig) {
      await service.storage.from(MESSAGE_BUCKET).remove([attachment.path]);
      return { ok: false, status: 400, error: "Only images (JPEG, PNG, WebP, GIF) and PDFs up to 10 MB can be attached." };
    }
    verified = {
      path: attachment.path,
      name: String(attachment.name ?? "file").slice(0, 120),
      type: realType,
      size: bytes.length,
    };
  }

  const { data: inserted, error } = await service
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_type: participant.role,
      sender_user_id: participant.userId,
      body: text.body,
      attachment_path: verified?.path ?? null,
      attachment_name: verified?.name ?? null,
      attachment_type: verified?.type ?? null,
      attachment_size: verified?.size ?? null,
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, status: 500, error: error?.message ?? "Couldn't send that message." };

  await service
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);

  // Email only if this is the sender's first message the other side hasn't read.
  const { count } = await service
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id)
    .eq("sender_type", participant.role)
    .is("read_at", null)
    .neq("id", inserted.id as string);

  await notifyNewMessage(service, {
    conversation,
    senderRole: participant.role,
    preview: text.body ? (text.body.length > 100 ? text.body.slice(0, 100) + "…" : text.body) : "Sent an attachment",
    emailFirstUnread: (count ?? 0) === 0,
  });

  return { ok: true, messageId: inserted.id as string };
}
```

- [ ] **Step 7: Type-check**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/tayloranderson/gigflow
git add lib/messages lib/email/message-notifications.ts
git commit -m "feat: messaging server helpers (access, threads, send, notify, unread)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Conversation list and create routes

**Files:**
- Create: `app/api/messages/conversations/route.ts`

**Interfaces:**
- Consumes: `getParticipant`, `buildConversationViews`, `sendMessage`, `ConversationRow`.
- Produces: `GET /api/messages/conversations` → `{ conversations: ConversationView[] }` (newest first). `POST /api/messages/conversations` body `{ artist_user_id: string, body?: string }` → `{ id: string }`; 403 for non-venues.

- [ ] **Step 1: Write the route**

```ts
// app/api/messages/conversations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ConversationRow, getParticipant } from "@/lib/messages/access";
import { buildConversationViews } from "@/lib/messages/threads";
import { sendMessage } from "@/lib/messages/send";

const COLUMNS = "id, venue_profile_id, artist_user_id, blocked_by, last_message_at, created_at";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant) return NextResponse.json({ error: "No account found" }, { status: 404 });

  const service = await createServiceClient();
  const { data: rows, error } = await service
    .from("conversations")
    .select(COLUMNS)
    .eq(participant.role === "venue" ? "venue_profile_id" : "artist_user_id",
        participant.role === "venue" ? participant.venueProfileId : participant.userId)
    .order("last_message_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const conversations = await buildConversationViews(service, participant, (rows ?? []) as ConversationRow[]);
  return NextResponse.json({ conversations });
}

// Venues only. Artists can reply inside a conversation but never start one.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant || participant.role !== "venue") {
    return NextResponse.json({ error: "Only venues can start a conversation." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const artistUserId = body.artist_user_id;
  if (typeof artistUserId !== "string" || !artistUserId) {
    return NextResponse.json({ error: "artist_user_id is required" }, { status: 400 });
  }

  const service = await createServiceClient();
  const { data: artist } = await service
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", artistUserId)
    .maybeSingle();
  if (!artist?.display_name) return NextResponse.json({ error: "That artist could not be found." }, { status: 404 });

  let { data: conversation } = await service
    .from("conversations")
    .select(COLUMNS)
    .eq("venue_profile_id", participant.venueProfileId)
    .eq("artist_user_id", artistUserId)
    .maybeSingle();

  if (!conversation) {
    const { data: created, error } = await service
      .from("conversations")
      .insert({ venue_profile_id: participant.venueProfileId, artist_user_id: artistUserId })
      .select(COLUMNS)
      .single();
    if (error?.code === "23505") {
      // Two requests raced; use the one that won.
      const { data: existing } = await service
        .from("conversations").select(COLUMNS)
        .eq("venue_profile_id", participant.venueProfileId).eq("artist_user_id", artistUserId).single();
      conversation = existing;
    } else if (error || !created) {
      return NextResponse.json({ error: error?.message ?? "Couldn't start that conversation." }, { status: 500 });
    } else {
      conversation = created;
    }
  }

  const row = conversation as ConversationRow;
  const hasFirstMessage = typeof body.body === "string" && body.body.trim().length > 0;
  if (hasFirstMessage) {
    const result = await sendMessage(service, { conversation: row, participant, body: body.body });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ id: row.id });
}
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/tayloranderson/gigflow
git add app/api/messages/conversations/route.ts
git commit -m "feat: list and start conversations (venue-only start)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Thread read and send routes

**Files:**
- Create: `app/api/messages/conversations/[id]/route.ts`, `app/api/messages/conversations/[id]/messages/route.ts`

**Interfaces:**
- Consumes: `getParticipant`, `loadOwnConversation`, `buildThread`, `sendMessage`, `AttachmentInput`.
- Produces: `GET /api/messages/conversations/[id]` → `ThreadView` (marks read); `POST /api/messages/conversations/[id]/messages` body `{ body?: string, attachment?: AttachmentInput }` → `{ id: string }`.

- [ ] **Step 1: Thread read** — `app/api/messages/conversations/[id]/route.ts`

```ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant, loadOwnConversation } from "@/lib/messages/access";
import { buildThread } from "@/lib/messages/threads";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant) return NextResponse.json({ error: "No account found" }, { status: 404 });

  const service = await createServiceClient();
  const conversation = await loadOwnConversation(service, participant, id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  return NextResponse.json(await buildThread(service, participant, conversation));
}
```

- [ ] **Step 2: Send** — `app/api/messages/conversations/[id]/messages/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant, loadOwnConversation } from "@/lib/messages/access";
import { sendMessage } from "@/lib/messages/send";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant) return NextResponse.json({ error: "No account found" }, { status: 404 });

  const service = await createServiceClient();
  const conversation = await loadOwnConversation(service, participant, id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const result = await sendMessage(service, {
    conversation,
    participant,
    body: body.body,
    attachment: body.attachment ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ id: result.messageId });
}
```

- [ ] **Step 3: Type-check and commit**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit` — expect no errors.

```bash
git add "app/api/messages/conversations/[id]"
git commit -m "feat: read a thread and send messages

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Attachment upload URL route

**Files:**
- Create: `app/api/messages/conversations/[id]/attachments/route.ts`

**Interfaces:**
- Consumes: Task 1 rules, `getParticipant`, `loadOwnConversation`.
- Produces: `POST /api/messages/conversations/[id]/attachments` body `{ name, type, size }` → `{ path: string, token: string }`. The client then calls `createClient().storage.from("message-attachments").uploadToSignedUrl(path, token, file, { contentType })` and passes `{ path, name, type, size }` as `attachment` when sending.

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant, loadOwnConversation } from "@/lib/messages/access";
import { MESSAGE_BUCKET, blockedSendError, sanitizeFileName, validateAttachmentDeclaration } from "@/lib/messages/rules";

// Step 1 of attaching a file: validate what the browser says it's about
// to upload and hand back a one-time signed upload URL token. Files go
// straight from the browser to storage (Vercel limits request bodies to
// ~4.5 MB, so a 10 MB file can't pass through this route). The real file
// type and size are checked again, from the stored file itself, when the
// message is sent (lib/messages/send.ts).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant) return NextResponse.json({ error: "No account found" }, { status: 404 });

  const service = await createServiceClient();
  const conversation = await loadOwnConversation(service, participant, id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const blocked = blockedSendError(conversation.blocked_by, participant.role);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const check = validateAttachmentDeclaration(String(body.type ?? ""), Number(body.size));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const path = `${conversation.id}/${randomUUID()}-${sanitizeFileName(String(body.name ?? "file"))}`;
  const { data, error } = await service.storage.from(MESSAGE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Couldn't prepare that upload. Try again." }, { status: 500 });

  return NextResponse.json({ path: data.path ?? path, token: data.token });
}
```

- [ ] **Step 2: Type-check and commit**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit` — expect no errors.

```bash
git add "app/api/messages/conversations/[id]/attachments"
git commit -m "feat: signed upload URLs for message attachments

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Block, unblock, and report routes

**Files:**
- Create: `app/api/messages/conversations/[id]/block/route.ts`, `app/api/messages/conversations/[id]/report/route.ts`

**Interfaces:**
- Produces: `POST .../block` → `{ success: true }` (sets `blocked_by` to the caller's role if currently null); `DELETE .../block` → `{ success: true }` (only if the caller is the blocker, else 403); `POST .../report` body `{ message_id: string, reason?: string }` → `{ success: true }` (reports only the **other** side's messages; inserts into `message_reports` and emails Taylor).

- [ ] **Step 1: Block / unblock** — `.../block/route.ts`

```ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant, loadOwnConversation } from "@/lib/messages/access";

async function context(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const participant = await getParticipant(supabase, user.id);
  if (!participant) return { error: NextResponse.json({ error: "No account found" }, { status: 404 }) };
  const service = await createServiceClient();
  const conversation = await loadOwnConversation(service, participant, id);
  if (!conversation) return { error: NextResponse.json({ error: "Conversation not found" }, { status: 404 }) };
  return { service, participant, conversation };
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context((await params).id);
  if ("error" in ctx) return ctx.error;
  if (!ctx.conversation.blocked_by) {
    const { error } = await ctx.service
      .from("conversations")
      .update({ blocked_by: ctx.participant.role })
      .eq("id", ctx.conversation.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// Only the person who blocked can unblock.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context((await params).id);
  if ("error" in ctx) return ctx.error;
  if (ctx.conversation.blocked_by !== ctx.participant.role) {
    return NextResponse.json({ error: "Only the person who blocked can unblock." }, { status: 403 });
  }
  const { error } = await ctx.service.from("conversations").update({ blocked_by: null }).eq("id", ctx.conversation.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Report** — `.../report/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant, loadOwnConversation } from "@/lib/messages/access";

function buildRowLink(messageId: string): string | null {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const match = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!match) return null;
  const query = `select * from messages where id = '${messageId}';`;
  return `https://supabase.com/dashboard/project/${match[1]}/sql/new?content=${encodeURIComponent(query)}`;
}

async function notifyTaylorOfReport(params: {
  messageId: string; conversationId: string; reporterUserId: string;
  body: string; attachmentName: string | null; reason: string | null;
}): Promise<void> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail) {
    console.error("message report: Resend not configured, skipping notification email");
    return;
  }
  const rowLink = buildRowLink(params.messageId);
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `StageReach <${fromEmail}>`,
    to: fromEmail,
    subject: "A message was reported on StageReach",
    text: [
      `Message ${params.messageId} (conversation ${params.conversationId}) was reported by user ${params.reporterUserId}.`,
      `Reason: ${params.reason ?? "(none given)"}`,
      "",
      `Message text: ${params.body || "(none)"}`,
      `Attachment: ${params.attachmentName ?? "(none)"}`,
      "",
      rowLink ?? "Look this row up directly in Supabase (messages table).",
    ].join("\n"),
  });
  if (error) console.error("message report: failed to send notification email", error);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant) return NextResponse.json({ error: "No account found" }, { status: 404 });

  const service = await createServiceClient();
  const conversation = await loadOwnConversation(service, participant, id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const messageId = typeof body.message_id === "string" ? body.message_id : "";
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 2000) : null;

  const { data: message } = await service
    .from("messages")
    .select("id, sender_type, body, attachment_name")
    .eq("id", messageId)
    .eq("conversation_id", conversation.id)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (message.sender_type === participant.role) {
    return NextResponse.json({ error: "You can only report messages from the other person." }, { status: 400 });
  }

  const { error: insertError } = await service
    .from("message_reports")
    .insert({ message_id: message.id, reporter_user_id: user.id, reason });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  try {
    await notifyTaylorOfReport({
      messageId: message.id as string,
      conversationId: conversation.id,
      reporterUserId: user.id,
      body: message.body as string,
      attachmentName: message.attachment_name as string | null,
      reason,
    });
  } catch (err) {
    console.error("message report: failed to send notification email", err);
  }
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Type-check and commit**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit` — expect no errors.

```bash
git add "app/api/messages/conversations/[id]/block" "app/api/messages/conversations/[id]/report"
git commit -m "feat: block, unblock, and report messages

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Unread-count and email-preference routes

**Files:**
- Create: `app/api/messages/unread-count/route.ts`, `app/api/messages/preferences/route.ts`

**Interfaces:**
- Consumes: `getParticipant`, `countUnreadMessages`.
- Produces: `GET /api/messages/unread-count` → `{ count: number }` (0 if not an account type that can message). `GET /api/messages/preferences` → `{ message_emails_enabled: boolean }`; `PATCH` body `{ message_emails_enabled: boolean }` → same shape.

- [ ] **Step 1: Unread count**

```ts
// app/api/messages/unread-count/route.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getParticipant } from "@/lib/messages/access";
import { countUnreadMessages } from "@/lib/messages/unread";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await getParticipant(supabase, user.id);
  if (!participant) return NextResponse.json({ count: 0 });

  const service = await createServiceClient();
  return NextResponse.json({ count: await countUnreadMessages(service, participant) });
}
```

- [ ] **Step 2: Preferences** — uses the RLS-scoped client; the `profiles` "own profile only" policy lets a user read and update only their own row.

```ts
// app/api/messages/preferences/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.from("profiles").select("message_emails_enabled").eq("id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message_emails_enabled: data?.message_emails_enabled ?? true });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.message_emails_enabled !== "boolean") {
    return NextResponse.json({ error: "message_emails_enabled must be true or false" }, { status: 400 });
  }
  const { error } = await supabase
    .from("profiles")
    .update({ message_emails_enabled: body.message_emails_enabled })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message_emails_enabled: body.message_emails_enabled });
}
```

- [ ] **Step 3: Type-check and commit**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit` — expect no errors.

```bash
git add app/api/messages/unread-count app/api/messages/preferences
git commit -m "feat: unread-message count and email preference routes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Messages UI and the two pages

**Files:**
- Create: `components/messages/MessagesView.tsx`, `app/(protected)/messages/page.tsx`, `app/venue/messages/page.tsx`

**Interfaces:**
- Consumes: all routes above; `ConversationView`, `ThreadView` types; rules constants; `createClient` from `lib/supabase/client.ts` (for `uploadToSignedUrl`).
- Produces: `<MessagesView role="artist" | "venue" initialConversationId?: string />`; pages `/messages` (artist) and `/venue/messages` (venue). Notification links `/messages?c=<id>` and `/venue/messages?c=<id>` open that thread directly.

- [ ] **Step 1: `components/messages/MessagesView.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ConversationView, ThreadView } from "@/types";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_LENGTH,
  MESSAGE_BUCKET,
  validateAttachmentDeclaration,
} from "@/lib/messages/rules";

const CARD = { backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function MessagesView({
  role,
  initialConversationId,
}: {
  role: "artist" | "venue";
  initialConversationId?: string;
}) {
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/messages/conversations");
    if (res.ok) setConversations((await res.json()).conversations ?? []);
    setLoadingList(false);
  }, []);

  const loadThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/messages/conversations/${id}`);
    if (res.ok) setThread(await res.json());
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    if (!activeId) { setThread(null); return; }
    loadThread(activeId);
  }, [activeId, loadThread]);

  // Simple polling — no realtime connection. Only while the tab is visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadList();
      if (activeId) loadThread(activeId);
    }, 15000);
    return () => clearInterval(t);
  }, [activeId, loadList, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  function pickFile(f: File | null) {
    setError("");
    if (!f) { setFile(null); return; }
    const check = validateAttachmentDeclaration(f.type, f.size);
    if (!check.ok) { setError(check.error); setFile(null); return; }
    setFile(f);
  }

  async function send() {
    if (!activeId || sending) return;
    if (!draft.trim() && !file) return;
    setError("");
    setSending(true);
    try {
      let attachment: { path: string; name: string; type: string; size: number } | null = null;
      if (file) {
        const prep = await fetch(`/api/messages/conversations/${activeId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
        });
        const prepJson = await prep.json();
        if (!prep.ok) throw new Error(prepJson.error ?? "Couldn't upload that file.");
        const { error: upErr } = await createClient()
          .storage.from(MESSAGE_BUCKET)
          .uploadToSignedUrl(prepJson.path, prepJson.token, file, { contentType: file.type });
        if (upErr) throw new Error("Couldn't upload that file. Try again.");
        attachment = { path: prepJson.path, name: file.name, type: file.type, size: file.size };
      }
      const res = await fetch(`/api/messages/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft, attachment }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't send that message.");
      setDraft("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await Promise.all([loadThread(activeId), loadList()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that message.");
    } finally {
      setSending(false);
    }
  }

  async function toggleBlock() {
    if (!activeId || !thread) return;
    setMenuOpen(false);
    const res = await fetch(`/api/messages/conversations/${activeId}/block`, {
      method: thread.blocked_by_me ? "DELETE" : "POST",
    });
    if (!res.ok) { setError((await res.json()).error ?? "Something went wrong."); return; }
    await Promise.all([loadThread(activeId), loadList()]);
  }

  async function report(messageId: string) {
    if (!activeId) return;
    const reason = window.prompt("What's wrong with this message? (optional)") ?? "";
    const res = await fetch(`/api/messages/conversations/${activeId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: messageId, reason }),
    });
    setError(res.ok ? "" : ((await res.json()).error ?? "Couldn't send that report."));
    if (res.ok) window.alert("Thanks — we've been notified and will take a look.");
  }

  const showThread = !!activeId;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 max-w-6xl">
      {/* Conversation list — hidden on mobile while a thread is open */}
      <div className={`${showThread ? "hidden md:block" : "block"} rounded-xl overflow-hidden`} style={CARD}>
        {loadingList ? (
          <p className="p-5 text-sm" style={{ color: "#9a9591" }}>Loading…</p>
        ) : conversations.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm font-medium mb-1" style={{ color: "#F4E8D2" }}>No messages yet</p>
            <p className="text-xs" style={{ color: "#9a9591" }}>
              {role === "venue"
                ? "Open an artist's profile and tap Message to start a conversation."
                : "When a venue messages you, the conversation will show up here."}
            </p>
          </div>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 transition-all hover:brightness-125"
              style={{
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                backgroundColor: c.id === activeId ? "rgba(212,166,79,0.08)" : "transparent",
              }}
            >
              <div
                className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold overflow-hidden"
                style={{ backgroundColor: "#1e2128", color: "#D4A64F" }}
              >
                {c.counterpart_photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.counterpart_photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  c.counterpart_name.slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm truncate" style={{ color: "#F4E8D2", fontWeight: c.unread_count > 0 ? 700 : 500 }}>
                    {c.counterpart_name}
                  </span>
                  <span className="text-xs shrink-0" style={{ color: "#5e5c58" }}>{fmtTime(c.last_message_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate" style={{ color: "#9a9591" }}>{c.last_message_preview || "No messages yet"}</span>
                  {c.unread_count > 0 && (
                    <span className="shrink-0 rounded-full text-xs font-bold px-1.5" style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}>
                      {c.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Thread */}
      <div className={`${showThread ? "flex" : "hidden md:flex"} flex-col rounded-xl overflow-hidden min-h-[60vh]`} style={CARD}>
        {!thread ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-sm" style={{ color: "#5e5c58" }}>{activeId ? "Loading…" : "Select a conversation"}</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <button onClick={() => setActiveId(null)} className="md:hidden text-sm" style={{ color: "#D4A64F" }} aria-label="Back to conversations">←</button>
              <Link href={thread.conversation.counterpart_href} className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: "#F4E8D2" }}>
                {thread.conversation.counterpart_name}
              </Link>
              <div className="relative">
                <button onClick={() => setMenuOpen((o) => !o)} className="px-2 text-lg" style={{ color: "#9a9591" }} aria-label="Conversation options">⋯</button>
                {menuOpen && (
                  <div className="absolute right-0 mt-1 rounded-lg z-10 py-1 min-w-[160px]" style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <button onClick={toggleBlock} className="w-full text-left px-3 py-2 text-sm" style={{ color: "#e25c5c" }}>
                      {thread.blocked_by_me ? "Unblock" : "Block"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {thread.booking && (
              <div className="px-4 py-2 text-xs" style={{ backgroundColor: "rgba(212,166,79,0.08)", color: "#D4A64F" }}>
                Booking request for {new Date(thread.booking.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {thread.booking.status}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-h-[55vh]">
              {thread.messages.map((m) => (
                <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className="rounded-2xl px-3 py-2 max-w-[80%] text-sm"
                    style={{ backgroundColor: m.mine ? "#D4A64F" : "#1e2128", color: m.mine ? "#0E0E10" : "#F4E8D2" }}
                  >
                    {m.attachment && (
                      m.attachment.type.startsWith("image/") ? (
                        <a href={m.attachment.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.attachment.url} alt={m.attachment.name} className="rounded-lg mb-1 max-h-60" />
                        </a>
                      ) : (
                        <a
                          href={m.attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5 mb-1 underline"
                          style={{ backgroundColor: "rgba(0,0,0,0.15)" }}
                        >
                          <span>📄</span>
                          <span className="truncate">{m.attachment.name}</span>
                          <span className="text-xs opacity-70 shrink-0">{fmtSize(m.attachment.size)}</span>
                        </a>
                      )
                    )}
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    <p className="text-[10px] mt-1 opacity-60 flex items-center gap-2">
                      {fmtTime(m.created_at)}
                      {!m.mine && (
                        <button onClick={() => report(m.id)} className="underline" aria-label="Report this message">Report</button>
                      )}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="p-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              {error && <p className="text-xs mb-2" style={{ color: "#e25c5c" }}>{error}</p>}
              {thread.conversation.blocked ? (
                <p className="text-xs text-center py-2" style={{ color: "#9a9591" }}>
                  {thread.blocked_by_me ? "You've blocked this conversation. Unblock it from the ⋯ menu to send messages." : "You can't send messages in this conversation."}
                </p>
              ) : (
                <>
                  {file && (
                    <div className="flex items-center gap-2 text-xs mb-2" style={{ color: "#F4E8D2" }}>
                      <span className="truncate">📎 {file.name} ({fmtSize(file.size)})</span>
                      <button onClick={() => { pickFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ color: "#9a9591" }} aria-label="Remove attachment">✕</button>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ALLOWED_ATTACHMENT_TYPES.join(",")}
                      className="hidden"
                      onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="shrink-0 rounded-lg px-3 py-2 text-lg"
                      style={{ backgroundColor: "#1e2128", color: "#9a9591", minHeight: "44px" }}
                      aria-label={`Attach a file (images or PDF, up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`}
                    >
                      📎
                    </button>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      maxLength={MAX_BODY_LENGTH}
                      rows={1}
                      placeholder="Write a message"
                      className="flex-1 rounded-lg px-3 py-2 text-sm resize-none"
                      style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2", minHeight: "44px" }}
                    />
                    <button
                      onClick={send}
                      disabled={sending || (!draft.trim() && !file)}
                      className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
                      style={{ backgroundColor: "#D4A64F", color: "#0E0E10", minHeight: "44px" }}
                    >
                      {sending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Artist page** — `app/(protected)/messages/page.tsx`

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MessagesView from "@/components/messages/MessagesView";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { c } = await searchParams;

  return (
    <div className="min-h-screen p-4 md:p-8" style={{ backgroundColor: "#0E0E10", color: "#F4E8D2" }}>
      <h1 className="text-2xl font-bold tracking-tight mb-6 pr-14 md:pr-0">Messages</h1>
      <MessagesView role="artist" initialConversationId={c} />
    </div>
  );
}
```

- [ ] **Step 3: Venue page** — `app/venue/messages/page.tsx`

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VenueNav from "@/components/venue/VenueNav";
import MessagesView from "@/components/messages/MessagesView";
import { getOwnCompletedVenueProfile } from "@/lib/bookings/venue-auth";

export default async function VenueMessagesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const venueProfile = await getOwnCompletedVenueProfile(supabase, user.id);
  if (!venueProfile) redirect("/venues/signup");
  const { c } = await searchParams;

  return (
    <>
      <VenueNav />
      <div className="min-h-screen pb-28 md:pb-0 p-4 md:p-8" style={{ backgroundColor: "#0E0E10", color: "#F4E8D2" }}>
        <h1 className="text-2xl font-bold tracking-tight mb-6 pr-14 md:pr-0">Messages</h1>
        <MessagesView role="venue" initialConversationId={c} />
      </div>
    </>
  );
}
```

- [ ] **Step 4: Type-check and lint**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit && npm run lint`
Expected: no errors in the new files (existing lint warnings elsewhere are not this task's concern).

- [ ] **Step 5: Commit**

```bash
git add components/messages/MessagesView.tsx "app/(protected)/messages" app/venue/messages
git commit -m "feat: Messages pages for artists and venues

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: "Message" button on the artist's public profile

**Files:**
- Create: `components/messages/MessageArtistButton.tsx`
- Modify: `app/profile/[id]/page.tsx` (import at the top with the other component imports; JSX directly after the `<div className="mb-6 flex items-center gap-3">…</div>` block that holds `RequestToBookButton`)

**Interfaces:**
- Consumes: `POST /api/messages/conversations`.
- Produces: `<MessageArtistButton artistUserId: string />`, rendered only for `viewerType === "venue"`; on click creates/finds the conversation and navigates to `/venue/messages?c=<id>`.

- [ ] **Step 1: Component**

```tsx
// components/messages/MessageArtistButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MessageArtistButton({ artistUserId }: { artistUserId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/messages/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist_user_id: artistUserId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Couldn't open a conversation. Try again.");
      setBusy(false);
      return;
    }
    router.push(`/venue/messages?c=${json.id}`);
  }

  return (
    <div>
      <button
        onClick={start}
        disabled={busy}
        className="block w-full text-center rounded-lg py-2.5 text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-60"
        style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#F4E8D2" }}
      >
        {busy ? "Opening…" : "Message"}
      </button>
      {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire it in** — in `app/profile/[id]/page.tsx` add `import MessageArtistButton from "@/components/messages/MessageArtistButton";` beside the `RequestToBookButton` import, and insert immediately after the closing `</div>` of the block that contains `<RequestToBookButton … />` and the favorite toggle:

```tsx
        {viewerType === "venue" && (
          <div className="mb-6 -mt-3">
            <MessageArtistButton artistUserId={id} />
          </div>
        )}
```

- [ ] **Step 3: Type-check and commit**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit` — expect no errors.

```bash
git add components/messages/MessageArtistButton.tsx "app/profile/[id]/page.tsx"
git commit -m "feat: venues can message an artist from their public profile

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Navigation, badge, and dashboard cards

**Files:**
- Modify: `components/venue/VenueNav.tsx`, `app/venue/dashboard/page.tsx`, `app/(protected)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/messages/unread-count`, `countUnreadMessages`, `getParticipant`.
- Produces: venue desktop bar = Dashboard, Discover Artists, Bookings, Invoices, Messages (badge), then Profile + bell; venue mobile bar = Dashboard, Discover, Bookings, Messages (badge), Profile. "Unread Messages" stat card on both dashboards.

- [ ] **Step 1: `VenueNav.tsx` — link arrays.** Replace the `mainLinks`/`profileLink`/`links` block with:

```tsx
const dashboardLink = { href: "/venue/dashboard", label: "Dashboard",        mobileLabel: "Dashboard", icon: "◆" };
// Favorites lives inside Discover Artists now (a "★ Favorites" dropdown
// near the top of that page) rather than as its own tab/page.
const discoverLink  = { href: "/venue/discover",  label: "Discover Artists", mobileLabel: "Discover",  icon: "⊕" };
const bookingsLink  = { href: "/venue/bookings",  label: "Bookings",         mobileLabel: "Bookings",  icon: "☐" };
// Invoices keeps its desktop tab but gave up its mobile slot to Messages
// (2026-10-06); on phones it's reached from the Dashboard's "Outstanding"
// card. "Ratings" (/venue/ratings) is likewise reached from a dashboard card.
const invoicesLink  = { href: "/venue/invoices",  label: "Invoices",         mobileLabel: "Invoices",  icon: "$" };
const messagesLink  = { href: "/venue/messages",  label: "Messages",         mobileLabel: "Messages",  icon: "✉" };
const profileLink = { href: "/venue/profile", label: "My Profile", mobileLabel: "Profile", icon: "◉" };

const desktopMainLinks = [dashboardLink, discoverLink, bookingsLink, invoicesLink, messagesLink];
const mobileLinks = [dashboardLink, discoverLink, bookingsLink, messagesLink, profileLink];
```

Update the existing JSX: the desktop bar maps `desktopMainLinks` (was `mainLinks`); the mobile bar maps `mobileLinks` (was `links`). Update the explanatory comment above the arrays if it still names `mainLinks`/`links`.

- [ ] **Step 2: `VenueNav.tsx` — unread badge.** Add `useEffect, useState` to the React import (`import { useEffect, useState } from "react";`), and inside `VenueNav()` after `const pathname = usePathname();`:

```tsx
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/messages/unread-count")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d) setUnreadMessages(d.count ?? 0); })
        .catch(() => {});
    }
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [pathname]);
```

Add a small helper component above `export default function VenueNav()`:

```tsx
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-[10px] font-bold px-1"
      style={{ backgroundColor: "#e25c5c", color: "#fff", minWidth: "16px", height: "16px" }}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
```

Render it: in the desktop bar link, after `{link.label}` add `{link.href === "/venue/messages" && <UnreadBadge count={unreadMessages} />}`. In the mobile bar, wrap the icon so the badge floats over it — replace `<span style={{ fontSize: "18px" }}>{link.icon}</span>` with:

```tsx
            <span className="relative" style={{ fontSize: "18px" }}>
              {link.icon}
              {link.href === "/venue/messages" && unreadMessages > 0 && (
                <span className="absolute -top-1 -right-3"><UnreadBadge count={unreadMessages} /></span>
              )}
            </span>
```

- [ ] **Step 3: Venue dashboard card** — in `app/venue/dashboard/page.tsx` add imports `import { getParticipant } from "@/lib/messages/access";` and `import { countUnreadMessages } from "@/lib/messages/unread";`; after the pending-ratings try/catch add:

```tsx
  // Unread messages — same defensive pattern as the ratings count above.
  let unreadMessagesCount = 0;
  try {
    const participant = await getParticipant(supabase, user.id);
    if (participant) unreadMessagesCount = await countUnreadMessages(service, participant);
  } catch (err) {
    console.error("venue dashboard: unread messages lookup failed", err);
  }
```

Insert into `statCards` right after the "Pending Requests" entry:

```tsx
    { label: "Unread Messages", value: unreadMessagesCount, trend: unreadMessagesCount > 0 ? "waiting for you" : "all caught up", color: unreadMessagesCount > 0 ? "#D4A64F" : "#9a9591", href: "/venue/messages" },
```

Change the grid class `md:grid-cols-5` to `md:grid-cols-6` on the stat-cards grid.

- [ ] **Step 4: Artist dashboard card** — in `app/(protected)/dashboard/page.tsx` add the same two imports (plus `createClient` is already imported); extend the existing pending-ratings try block's neighbor with:

```tsx
  let unreadMessagesCount = 0;
  try {
    const service = await createServiceClient();
    const participant = await getParticipant(supabase, user.id);
    if (participant) unreadMessagesCount = await countUnreadMessages(service, participant);
  } catch (err) {
    console.error("dashboard: unread messages lookup failed", err);
  }
```

(Use the same variable that holds the page's RLS-scoped client — confirm its name in that file; it is `supabase` in sibling pages.) Append to the `statCards` array after "Pending Ratings":

```tsx
    {
      label: "Unread Messages",
      value: unreadMessagesCount,
      trend: unreadMessagesCount > 0 ? "waiting for you" : "all caught up",
      color: unreadMessagesCount > 0 ? "#D4A64F" : "#9a9591",
      href: "/messages",
    },
```

Change the stat grid class (line ~301) from `md:grid-cols-6` to `md:grid-cols-4 lg:grid-cols-7`.

- [ ] **Step 5: Type-check, lint, visual check**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit && npm run lint`
Expected: no new errors. Then start the dev server (`preview_start` name `gigflow`) and, at mobile width (375px), confirm the venue bottom bar shows five tabs and none overflow. (Logging in requires Taylor's test accounts; if unavailable, defer the visual check to Task 13.)

- [ ] **Step 6: Commit**

```bash
git add components/venue/VenueNav.tsx app/venue/dashboard/page.tsx "app/(protected)/dashboard/page.tsx"
git commit -m "feat: Messages tab and unread badges, dashboard cards

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: "Email me about new messages" toggle

**Files:**
- Create: `components/messages/MessageEmailToggle.tsx`
- Modify: `app/(protected)/artist-profile/page.tsx` (render directly after `<PushToggle />` at ~line 843), `app/venue/profile/page.tsx` (inside the card containing `<PushToggle />` at ~line 199)

**Interfaces:**
- Consumes: `GET`/`PATCH /api/messages/preferences`.
- Produces: `<MessageEmailToggle />` — label "Email me about new messages" with helper text making clear in-app and phone alerts stay on.

- [ ] **Step 1: Component**

```tsx
// components/messages/MessageEmailToggle.tsx
"use client";

import { useEffect, useState } from "react";

export default function MessageEmailToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/messages/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(d ? !!d.message_emails_enabled : true))
      .catch(() => setEnabled(true));
  }, []);

  async function toggle() {
    if (enabled === null) return;
    const next = !enabled;
    setEnabled(next);
    setError("");
    const res = await fetch("/api/messages/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_emails_enabled: next }),
    });
    if (!res.ok) {
      setEnabled(!next);
      setError("Couldn't save that. Try again.");
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 mt-3">
      <div>
        <p className="text-sm font-medium" style={{ color: "#F4E8D2" }}>Email me about new messages</p>
        <p className="text-xs mt-0.5" style={{ color: "#9a9591" }}>
          You&apos;ll still see new messages in the app and get phone alerts if those are on.
        </p>
        {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
      </div>
      <button
        role="switch"
        aria-checked={!!enabled}
        aria-label="Email me about new messages"
        onClick={toggle}
        disabled={enabled === null}
        className="shrink-0 rounded-full transition-all disabled:opacity-50"
        style={{ width: "44px", height: "26px", backgroundColor: enabled ? "#D4A64F" : "#2a2a2e", position: "relative" }}
      >
        <span
          className="absolute rounded-full transition-all"
          style={{ top: "3px", left: enabled ? "21px" : "3px", width: "20px", height: "20px", backgroundColor: "#F4E8D2" }}
        />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Render it** — in both profile pages, add `import MessageEmailToggle from "@/components/messages/MessageEmailToggle";` beside the `PushToggle` import and render `<MessageEmailToggle />` immediately after `<PushToggle />`.

- [ ] **Step 3: Type-check and commit**

Run: `cd /Users/tayloranderson/gigflow && npx tsc --noEmit` — expect no errors.

```bash
git add components/messages/MessageEmailToggle.tsx "app/(protected)/artist-profile/page.tsx" app/venue/profile/page.tsx
git commit -m "feat: toggle for new-message emails on both profile pages

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docs, end-to-end check, and ship

**Files:**
- Modify: `CLAUDE.md`, `CHANGELOG.md`

- [ ] **Step 1: Update `CLAUDE.md`**

- Commands: replace "No test suite is currently configured." with "`npm test` runs Vitest (only the pure messaging rules in `lib/messages/rules.test.ts` have tests so far)."
- Core Data Model: add entries for `conversations`, `messages`, `message_reports` (service-role-only, no policies; one conversation per venue/artist pair; only a venue can start one; block/unblock, report; attachments in private `message-attachments` bucket via signed URLs, 10 MB, images + PDF, verified by file content) and `profiles.message_emails_enabled`.
- Key Flows: add a "Messaging" paragraph (rules, `lib/messages/*` helpers, routes under `/api/messages/*`, pages `/messages` and `/venue/messages`, alerts: in-app + push always, email only for first unread, opt-out toggle; venue mobile nav swaps Invoices for Messages; 15-second polling, no realtime) and note the `gig_reminder` constraint fix.
- Migrations: mention `030_messaging.sql`.

- [ ] **Step 2: Update `CHANGELOG.md`** — add at the top, under a new dated heading:

```
## 2026-10-06 (messaging)
- [Feature] Venues and artists can now message each other inside StageReach. A venue starts a conversation from an artist's profile (artists can reply but not start one, so venues aren't spammed), and either side can attach one image or PDF (stage plots, parking maps, rider sheets — up to 10 MB). There's an unread badge, a Messages page for each side, and block and report options.
- [Change] On phones, the venue bottom bar now has Messages in place of Invoices; invoices are reached from the Dashboard card.
- [Feature] A new "Email me about new messages" switch on both profile pages turns off the email only — in-app and phone alerts stay on.
- [Fix] Day-of gig reminders weren't showing in the notification bell (the database rejected that notification type); fixed alongside the messaging changes.
```

- [ ] **Step 3: Full automated checks**

Run: `cd /Users/tayloranderson/gigflow && npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: tests pass, no type errors, build succeeds.

- [ ] **Step 4: Manual end-to-end check (Taylor logs in; Claude never types credentials)**

On localhost with one test venue account and one test artist account, in two browsers/profiles:
1. Venue opens the artist's `/profile/[id]` → "Message" button appears; artist (logged in as artist) and logged-out viewers do not see it.
2. Venue starts a thread, sends text → artist gets a bell notification, an unread count on the Dashboard card, and (if enabled) one email; a second venue message does **not** send a second email.
3. Artist opens `/messages`, sees the thread, replies → venue sees the badge on the Messages tab; opening the thread clears it.
4. Attach a PNG and a PDF (each previews/opens); try a 12 MB file and a `.zip` (rejected with a plain message); rename a `.txt` to `.pdf` (rejected on send).
5. Artist tries `POST /api/messages/conversations` (e.g. via the browser console) → 403.
6. Block from either side → the other can't send (neutral message), blocker sees "Unblock"; unblock restores sending. Report a message → Taylor gets the email.
7. Turn "Email me about new messages" off → next first-unread message sends no email but still shows in the bell/badge.
8. At 375px width, the venue bottom bar shows Dashboard, Discover, Bookings, Messages, Profile with no overflow, and the Dashboard "Outstanding" card still opens invoices.

- [ ] **Step 5: Commit and (with Taylor's go-ahead) push**

```bash
cd /Users/tayloranderson/gigflow
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document messaging in CLAUDE.md and changelog

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Ask Taylor before running `git push` (Task 2's migration must already be applied in Supabase, or the deployed pages will error).
