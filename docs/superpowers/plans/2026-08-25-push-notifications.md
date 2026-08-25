# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real phone lock-screen alerts for the two notification types worth interrupting someone for (new booking request, booking accepted/declined), on top of the already-shipped in-app notification center.

**Architecture:** A new `push_subscriptions` table records one row per device a user has enabled alerts on. A service worker (`public/sw.js`) handles incoming push events and notification taps. `lib/notifications/create.ts`'s existing `createNotification` helper gets a small extension — when the notification type is one of the two-and-a-half "pushable" types, it also calls a new `sendPushToUser` — so none of its 8 existing call sites change at all. A new toggle component on both profile pages handles the subscribe/unsubscribe flow.

**Tech Stack:** Next.js App Router route handlers, Supabase (service-role client, no RLS — matches every other table this session), the `web-push` npm package, the browser's native Push API + Service Worker API.

**No automated test suite exists in this project** (confirmed in `CLAUDE.md`). Verification throughout is `npx tsc --noEmit`, `npx eslint`, `npm run build`, and manual/live checks. **One important limit on this plan specifically:** unlike every other feature built this session, *actually receiving a push notification on a real phone* cannot be verified by whoever executes this plan — there's no real device, and OS-level notification permission can't be granted programmatically. Task 10 makes clear what's checkable without a device and what genuinely needs Taylor to do it herself afterward.

---

### Task 1: Install `web-push` and generate VAPID keys

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)

- [ ] **Step 1: Install the package**

```bash
npm install web-push
npm install -D @types/web-push
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors (nothing uses the package yet).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add web-push dependency"
```

- [ ] **Step 4: Generate a real VAPID key pair**

This step produces actual secret values — do not commit them anywhere, and don't put them in this repo in any form. Run a one-off script:

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

This prints a `{ publicKey, privateKey }` object. Report both values back to whoever is coordinating this work (the agent running this plan should surface them in its final report) — Taylor needs to add three environment variables to both `.env.local` and Vercel's Production settings:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = the generated `publicKey`
- `VAPID_PRIVATE_KEY` = the generated `privateKey`
- `VAPID_SUBJECT` = `mailto:` followed by a contact address Taylor is fine with push services being able to reach if there's a delivery problem (e.g. `mailto:booking@taylorandersonmusic.com`) — ask if unsure which address, don't guess.

This step has no code to commit — it's a one-time value-generation step. Flag clearly in the final report that these three env vars must be set (locally and in Vercel) before Task 3 onward can actually be exercised end-to-end, though `tsc`/`eslint`/`build` will all stay clean without them since VAPID initialization is lazy (see Task 3).

---

### Task 2: Migration

**Files:**
- Create: `supabase/migrations/022_push_subscriptions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/022_push_subscriptions.sql
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index idx_push_subscriptions_user on public.push_subscriptions (user_id);

-- RLS is enabled (required so PostgREST doesn't expose this table to
-- anon/authenticated clients directly) but deliberately gets NO policies
-- — every read/write goes through the service-role client from a server
-- route that's already verified the caller's identity. Same pattern as
-- notifications, booking_requests, and venue_artist_ratings.
alter table public.push_subscriptions enable row level security;
```

`endpoint` is the push service URL the browser generates per subscription — globally unique per device+browser+install, which is why it's both the primary natural key for identifying "this one device" and the right conflict target for upserts (Task 6).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors (pure SQL, nothing references it yet).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_push_subscriptions.sql
git commit -m "feat: add push_subscriptions table"
```

- [ ] **Step 4: Run the migration** — this step is for Taylor, not the agent. Flag clearly at the end of this plan that `022_push_subscriptions.sql` needs to run in the Supabase SQL Editor before this feature works.

---

### Task 3: `sendPushToUser`

**Files:**
- Create: `lib/push/send.ts`

**Context — read this carefully before writing any code:** `web-push`'s `setVapidDetails(...)` call MUST happen lazily, inside the function, never at module top-level. If it ran at import time and `VAPID_PRIVATE_KEY` were unset (e.g. in the window between this deploying and Taylor adding the env vars to Vercel), importing this file would throw — and since Task 4 makes `lib/notifications/create.ts` statically import from this file, that would break notification creation for **all six** existing notification types, not just the three pushable ones. Get this exactly right.

- [ ] **Step 1: Write the helper**

```typescript
// lib/push/send.ts
import webpush from "web-push";
import { SupabaseClient } from "@supabase/supabase-js";

let vapidConfigured = false;

// Configures web-push with the VAPID keys on first real use, not at
// module import time — see this file's header comment in the plan for
// why an eager call here would be a serious problem. Returns false
// (without throwing) if the required env vars aren't set, so callers
// can skip sending rather than crash.
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (process.env.VAPID_SUBJECT ?? "").trim();
  if (!publicKey || !privateKey || !subject) {
    console.error("sendPushToUser: VAPID env vars not configured, skipping push send");
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

// Sends a push notification to every device a user has subscribed on.
// Never throws — a failed push send must never affect the in-app
// notification it's attached to. Logs and continues past a single
// failed device rather than aborting the rest.
export async function sendPushToUser(
  service: SupabaseClient,
  userId: string,
  payload: { title: string; body?: string; url: string }
): Promise<void> {
  if (!ensureVapidConfigured()) return;

  const { data: subscriptions, error } = await service
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) {
    console.error("sendPushToUser: subscriptions lookup failed", error);
    return;
  }
  if (!subscriptions || subscriptions.length === 0) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    url: payload.url,
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint as string,
          keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
        },
        body
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Push service says this subscription is gone for good (device
        // uninstalled the app, revoked permission at the OS level, etc.)
        // — clean it up so we stop retrying it forever.
        const { error: deleteError } = await service
          .from("push_subscriptions")
          .delete()
          .eq("id", sub.id as string);
        if (deleteError) {
          console.error("sendPushToUser: failed to delete stale subscription", deleteError);
        }
      } else {
        console.error("sendPushToUser: send failed for one subscription", err);
      }
    }
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors. (This should pass even without the VAPID env vars set — `ensureVapidConfigured` only checks them at call time, never at import time.)

- [ ] **Step 3: Verify the lazy-init guarantee by reading the code back**

Re-read the file you just wrote and confirm: `webpush.setVapidDetails(...)` appears ONLY inside `ensureVapidConfigured`'s function body, never at module top-level (i.e. never directly inside the top-level `import`/`let` statements before any function declaration). This project has no `tsx`/`ts-node` installed, so a live "does importing this throw" smoke test isn't practical here — Task 9's manual verification step covers the real-world version of this check instead, by building and running the whole app with the VAPID env vars unset.

- [ ] **Step 4: Commit**

```bash
git add lib/push/send.ts
git commit -m "feat: add sendPushToUser helper"
```

---

### Task 4: Wire push into `createNotification`

**Files:**
- Modify: `lib/notifications/create.ts`

- [ ] **Step 1: Read the current file**

```typescript
import { SupabaseClient } from "@supabase/supabase-js";
import { NotificationType } from "@/types";

export async function createNotification(
  service: SupabaseClient,
  params: { userId: string; type: NotificationType; title: string; body?: string; link: string }
): Promise<void> {
  const { error } = await service.from("notifications").insert({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link,
  });
  if (error) console.error("createNotification: insert failed", error);
}
```

- [ ] **Step 2: Add the push integration**

Change to:

```typescript
import { SupabaseClient } from "@supabase/supabase-js";
import { NotificationType } from "@/types";
import { sendPushToUser } from "@/lib/push/send";

const PUSHABLE_TYPES = new Set<NotificationType>([
  "booking_request_received",
  "booking_request_accepted",
  "booking_request_declined",
]);

export async function createNotification(
  service: SupabaseClient,
  params: { userId: string; type: NotificationType; title: string; body?: string; link: string }
): Promise<void> {
  const { error } = await service.from("notifications").insert({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link,
  });
  if (error) console.error("createNotification: insert failed", error);

  if (PUSHABLE_TYPES.has(params.type)) {
    try {
      await sendPushToUser(service, params.userId, {
        title: params.title,
        body: params.body,
        url: params.link,
      });
    } catch (err) {
      console.error("createNotification: push send failed", err);
    }
  }
}
```

The push attempt runs regardless of whether the notification insert above it succeeded or failed — a database hiccup on the in-app side shouldn't also silently kill the phone alert. `sendPushToUser` itself never throws (Task 3), so this outer `try/catch` is defense in depth, matching the convention already used everywhere else notification-adjacent code is called.

**This task requires ZERO changes to any of the 8 files that call `createNotification`** (`app/api/venues/follow-up/route.ts`, `app/api/venue/booking-requests/route.ts`, `app/api/booking-requests/[id]/route.ts` — twice, `lib/email/rating-notifications.ts` — four times). Don't touch any of them.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Confirm no call sites were touched**

```bash
git diff --stat
```

Expected: only `lib/notifications/create.ts` listed.

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/create.ts
git commit -m "feat: send push notifications for pushable notification types"
```

---

### Task 5: Service worker + middleware allowlist

**Files:**
- Create: `public/sw.js`
- Modify: `proxy.ts`

- [ ] **Step 1: Write the service worker**

```javascript
// public/sw.js
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "StageReach", {
      body: data.body || "",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

This is a plain static file served as-is from `/public` — no bundler, no TypeScript, no build step touches it. It's fetched directly by the browser at `/sw.js` when a client registers it (Task 7).

- [ ] **Step 2: Allow it through the auth middleware**

`proxy.ts`'s `isPublicRoute` check currently reads (around lines 35-47):

```typescript
  const isPublicRoute =
    pathname.startsWith("/profile/") ||
    pathname.startsWith("/venues/profile/") ||
    pathname.startsWith("/api/public/") ||
    pathname === "/api/calendar/ics" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/api/auth/validate-code" ||
    pathname === "/api/auth/confirm" ||
    pathname === "/signup" ||
    pathname === "/venues" ||
    pathname === "/venues/signup";
```

Add `/sw.js` to this list, in the same style as the existing `/manifest.webmanifest` entry:

```typescript
  const isPublicRoute =
    pathname.startsWith("/profile/") ||
    pathname.startsWith("/venues/profile/") ||
    pathname.startsWith("/api/public/") ||
    pathname === "/api/calendar/ics" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/api/auth/validate-code" ||
    pathname === "/api/auth/confirm" ||
    pathname === "/signup" ||
    pathname === "/venues" ||
    pathname === "/venues/signup";
```

Without this, the middleware would redirect a logged-out browser's fetch of `/sw.js` to `/login`, breaking registration for anyone not currently authenticated at the moment the service worker tries to (re)register — the same class of bug already found and fixed for `/manifest.webmanifest` earlier this project.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add public/sw.js proxy.ts
git commit -m "feat: add service worker and allow it through auth middleware"
```

---

### Task 6: Subscribe / unsubscribe API routes

**Files:**
- Create: `app/api/push/subscribe/route.ts`

- [ ] **Step 1: Write both handlers in one file**

```typescript
// app/api/push/subscribe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { endpoint, keys } = body;
  if (typeof endpoint !== "string" || !endpoint || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") {
    return NextResponse.json({ error: "endpoint and keys.p256dh/keys.auth are required" }, { status: 400 });
  }

  const service = await createServiceClient();
  const { error } = await service.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { endpoint } = body;
  if (typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }

  const service = await createServiceClient();
  const { error } = await service
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

The `DELETE` handler scopes on both `endpoint` and `user_id` — not just `endpoint` — so one user can never delete another user's subscription row even by guessing/replaying an endpoint value.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/push/subscribe/route.ts
git commit -m "feat: add push subscribe/unsubscribe endpoints"
```

---

### Task 7: `PushToggle` component, wired into both profile pages

**Files:**
- Create: `components/notifications/PushToggle.tsx`
- Modify: `app/(protected)/artist-profile/page.tsx`
- Modify: `app/venue/profile/page.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/notifications/PushToggle.tsx
"use client";

import { useState, useEffect } from "react";

type Status = "checking" | "unsupported" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function PushToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const existing = await registration?.pushManager.getSubscription();
        setStatus(existing ? "on" : "off");
      } catch {
        setStatus("off");
      }
    })();
  }, []);

  async function handleEnable() {
    setBusy(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = subscription.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) {
        setError("Couldn't save your device — please try again.");
        return;
      }
      setStatus("on");
    } catch {
      setError("Couldn't enable notifications — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setStatus("off");
    } catch {
      setError("Couldn't disable notifications — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") return null;

  return (
    <div
      className="rounded-lg px-3 py-2 mt-2"
      style={{ backgroundColor: "#1e2128" }}
    >
      <div className="flex items-center justify-between">
        <div style={{ color: "#F4E8D2", fontSize: "12px", fontWeight: 500 }}>Phone notifications</div>
        {status === "unsupported" && <span style={{ color: "#5e5c58", fontSize: "10px" }}>Not available</span>}
        {status === "denied" && <span style={{ color: "#5e5c58", fontSize: "10px" }}>Blocked</span>}
        {(status === "off" || status === "on") && (
          <button
            onClick={status === "on" ? handleDisable : handleEnable}
            disabled={busy}
            className="text-xs px-2.5 py-1 rounded font-semibold transition-all hover:brightness-110"
            style={{
              backgroundColor: status === "on" ? "rgba(255,255,255,0.04)" : "#D4A64F",
              color: status === "on" ? "#9a9591" : "#0E0E10",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "…" : status === "on" ? "Disable" : "Enable"}
          </button>
        )}
      </div>
      {status === "unsupported" && (
        <p style={{ color: "#5e5c58", fontSize: "10px", marginTop: "4px" }}>
          Not available in this browser. On iPhone: add StageReach to your home screen first (Share → Add to Home Screen), then try again from there.
        </p>
      )}
      {status === "denied" && (
        <p style={{ color: "#5e5c58", fontSize: "10px", marginTop: "4px" }}>
          Notifications were blocked. Check your phone or browser&apos;s notification settings for StageReach to turn them back on.
        </p>
      )}
      {error && <p style={{ color: "#e25c5c", fontSize: "10px", marginTop: "4px" }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the Artist Profile page's Connected Accounts section**

In `app/(protected)/artist-profile/page.tsx`, add the import:

```typescript
import PushToggle from "@/components/notifications/PushToggle";
```

Inside the "Connected Accounts" card, after the `{connectionsLoading ? ... : (...)}` block closes and before that card's own closing `</div>` (currently around lines 631-711 — re-verify the exact lines against the real file, they may have drifted), add:

```tsx
            <PushToggle />
```

- [ ] **Step 3: Wire into the Venue Profile page**

`app/venue/profile/page.tsx` has no "Connected Accounts" section today (venues don't connect Gmail/Outlook) — add a small new card for it. Add the import:

```typescript
import PushToggle from "@/components/notifications/PushToggle";
```

Add a new card between the header (`<div className="flex items-center justify-between mb-8">...</div>`) and the `{error && (...)}` block:

```tsx
        <div
          className="rounded-xl p-4 mb-6"
          style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <PushToggle />
        </div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Lint**

Run: `npx eslint components/notifications/PushToggle.tsx "app/(protected)/artist-profile/page.tsx" app/venue/profile/page.tsx`
Expected: No new errors (pre-existing warnings elsewhere are fine).

- [ ] **Step 6: Commit**

```bash
git add components/notifications/PushToggle.tsx "app/(protected)/artist-profile/page.tsx" app/venue/profile/page.tsx
git commit -m "feat: add PushToggle to artist and venue profile pages"
```

---

### Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md**

In the Key Flows section, right after the "Notification Center" paragraph, add a new paragraph describing push notifications: a `push_subscriptions` table (migration `022_push_subscriptions.sql`, RLS enabled with no policies, one row per subscribed device); `lib/push/send.ts`'s `sendPushToUser` (lazily-initialized VAPID via the `web-push` package, deletes a subscription on a 404/410 "gone" response); wired into `lib/notifications/create.ts` for exactly two of the six notification types (`booking_request_received`, `booking_request_accepted`, `booking_request_declined`); a service worker at `public/sw.js` (allowlisted in `proxy.ts` alongside `/manifest.webmanifest`); subscribe/unsubscribe via `POST`/`DELETE /api/push/subscribe`; a `PushToggle` component on both the Artist Profile and Venue Profile pages. Note the iOS-must-be-installed-to-home-screen limitation.

Also add the three new environment variables (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) to the Environment Variables section at the bottom of the file, following the existing format.

- [ ] **Step 2: Add a CHANGELOG entry**

Check the current top of `CHANGELOG.md` first for the correct date/ordering (add above any existing same-date entries, most recent first):

```
## 2026-08-25 (push notifications)
- [Feature] Real phone alerts, on top of the notification bell — a new booking request, or a response to one you sent, now buzzes your phone directly (if you've turned it on from your Profile page), even when StageReach isn't open. The other notification types stay bell-only for now.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: document push notifications"
```

---

### Task 9: Manual verification

No automated test suite exists in this project, and **actually receiving a push notification cannot be verified without a real device** — that part is explicitly for Taylor to do herself, after this ships (see below). What IS checkable here:

- [ ] Confirm the dev server builds and starts without errors.
- [ ] Confirm `npx tsc --noEmit`, `npx eslint`, and `npm run build` are all clean across the whole project (not just touched files).
- [ ] Confirm `curl` against `http://localhost:3000/sw.js` (with the dev server running) returns `200` with `Content-Type: application/javascript` or similar — not a redirect to `/login`, proving the `proxy.ts` allowlist change works.
- [ ] Confirm `curl -X POST http://localhost:3000/api/push/subscribe` (no auth) returns `401`, and same for `DELETE` — proving both routes correctly require auth without crashing.
- [ ] Confirm the app **still builds and runs correctly with the VAPID env vars unset** — this is the critical regression check from this plan's Task 3: temporarily comment out (or don't set) `VAPID_PRIVATE_KEY` in the local environment and confirm the dev server still starts and existing pages (e.g. a public profile page) still load without error, proving the lazy-init guarantee actually holds in practice, not just in code review.
- [ ] Confirm `PushToggle` renders on the Artist Profile page without crashing (log in as any test artist, or check via a component-level read of the rendered HTML if a real login isn't available in this environment).

**For Taylor, after this ships and the migration has run:**
1. Add the three VAPID environment variables to Vercel (values were generated and reported in Task 1) and redeploy.
2. On your own phone, make sure StageReach is added to your home screen (if not already).
3. Open StageReach from the home screen icon, go to your Artist Profile, and tap "Enable" under Phone notifications — approve the permission prompt.
4. Trigger a real booking request (from your test venue account) and confirm an actual notification appears on your phone's lock screen, even with StageReach closed.
5. Tap it and confirm it opens StageReach to the right page.

This is the one piece of this feature nobody but Taylor can verify — flag this clearly when reporting this plan's completion.
