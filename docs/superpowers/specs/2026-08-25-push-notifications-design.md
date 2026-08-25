# Push Notifications — Design Spec

**Status:** Approved by Taylor (2026-08-25)

## Background

StageReach's in-app notification center (shipped 2026-08-24/25) covers six events via a `notifications` table and `lib/notifications/create.ts`'s `createNotification` helper, displayed via a bell icon in the nav. This was always phase 1 of 2 — this spec covers phase 2: real push notifications that land on a phone's lock screen / notification tray even when StageReach isn't open, for the two event types worth interrupting someone for (a new booking request, and a booking request being accepted or declined). The other four notification types (rating available, rating revealed, follow-up sent) stay in-app-only, per Taylor's explicit choice.

This project currently has zero push infrastructure — no service worker, no `web-push` package, no VAPID keys. This is a from-scratch build.

## Non-Goals

- Push for the four non-booking notification types (rating available/revealed, follow-up sent) — bell-only, as today.
- Any settings UI beyond a single on/off toggle (no per-type push preferences, no quiet hours, no digest/batching).
- Rich push content (images, action buttons in the notification itself) — title + body + a single tap-to-open action only.
- A fallback in-browser prompt UI explaining "why enable notifications" beyond the toggle's own label/description — no separate onboarding modal.

## Platform Reality (accepted, not a bug to work around)

iOS Safari supports web push only for a PWA added to the home screen (iOS 16.4+) — not for the site open in a regular Safari tab. Android Chrome has no such restriction. The toggle (see UI section) detects support via feature-checking `serviceWorker`/`PushManager`/`Notification` on `window`/`navigator`; where unsupported, it shows an explanatory message rather than a non-functional control:

> "Not available in this browser. On iPhone: add StageReach to your home screen first (Share → Add to Home Screen), then try again from there."

## Data Model

New table (migration `supabase/migrations/022_push_subscriptions.sql`):

```sql
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index idx_push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
```

`endpoint` (the push service URL the browser generates per subscription) is globally unique per device+browser+install, so it's the natural conflict target for upserts — one row per subscribed device, a user can have several (phone, desktop browser, etc.), each pushed to independently. RLS enabled with no policies, same established pattern as `notifications`/`booking_requests`/`venue_artist_ratings` — every read/write goes through the service-role client from a server route that's already verified the caller.

## Subscribing

**New endpoints:**
- `POST /api/push/subscribe` — auth required. Body: `{ endpoint: string; keys: { p256dh: string; auth: string } }` (the shape the browser's `PushSubscription.toJSON()` already produces). Upserts on `endpoint` conflict, setting `user_id`/`p256dh`/`auth` — handles the same device resubscribing.
- `DELETE /api/push/subscribe` — auth required. Body: `{ endpoint: string }`. Deletes that one subscription row (used when the toggle is turned off, or the client detects its subscription is gone).

**New public env var:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — the VAPID key pair's public half, needed client-side to call `pushManager.subscribe()`. Not secret; follows this project's existing `NEXT_PUBLIC_*` convention for values that must reach the browser. The private half (`VAPID_PRIVATE_KEY`) and a `VAPID_SUBJECT` (a `mailto:` contact address the push services can reach if there's a delivery problem) are server-only, used only when actually sending.

## Sending

New `lib/push/send.ts`:

```typescript
export async function sendPushToUser(
  service: SupabaseClient,
  userId: string,
  payload: { title: string; body?: string; url: string }
): Promise<void>
```

Looks up every `push_subscriptions` row for `userId`, and for each, calls the `web-push` package's `sendNotification` with the stored `endpoint`/`p256dh`/`auth` and the VAPID keys. Never throws (same convention as `createNotification`) — logs and continues past a failed send to one device rather than aborting the others. If a send fails with a 404 or 410 status (the push service reports the subscription is gone — the user uninstalled, revoked permission at the OS level, etc.), delete that subscription row so it stops being retried forever; other error codes are just logged.

**Integration point:** `createNotification` (`lib/notifications/create.ts`) gains a check against a fixed set of pushable types:

```typescript
const PUSHABLE_TYPES = new Set<NotificationType>([
  "booking_request_received",
  "booking_request_accepted",
  "booking_request_declined",
]);
```

When `params.type` is in this set, `createNotification` also calls `sendPushToUser(service, params.userId, { title: params.title, body: params.body, url: params.link })`, independently of whether the `notifications` row insert itself succeeded — a database hiccup on the in-app side shouldn't also silently kill the phone alert, and vice versa. This means **none of `createNotification`'s existing eight call sites** (across `app/api/venues/follow-up/route.ts`, `app/api/venue/booking-requests/route.ts`, `app/api/booking-requests/[id]/route.ts` (two), and `lib/email/rating-notifications.ts` (four)) **need to change at all** — the same integration principle already used for the in-app center (extend the shared helper, not each call site) applies here too.

**VAPID initialization must be lazy, not eager.** `lib/push/send.ts` will call the `web-push` package's `setVapidDetails(...)` using `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`. If that call runs at module top-level (the naive way to write it), importing `sendPushToUser` would throw the moment `VAPID_PRIVATE_KEY` is unset — e.g. in the window between this branch deploying and Taylor adding the new env vars to Vercel. Since `createNotification` statically imports from this file, an eager throw there would break notification creation for **all six types**, not just the three pushable ones. `setVapidDetails` must be called lazily, inside `sendPushToUser` itself (or guarded so a missing env var short-circuits with a logged warning rather than throwing), never at import time.

**New dependency.** `web-push` is not yet in `package.json` — the implementation needs `npm install web-push` plus `@types/web-push` as a dev dependency, since `web-push` ships no bundled TypeScript types.

## Service Worker

New `public/sw.js`, a plain static file (no bundler involvement):

```javascript
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

`proxy.ts`'s public-route allowlist needs `/sw.js` added, the same way `/manifest.webmanifest` already is — otherwise the auth middleware would intercept the browser's fetch of this file.

## UI: The Toggle

A new `components/notifications/PushToggle.tsx`, placed on the Artist Profile page inside the existing "Connected Accounts" section (same visual treatment as the Gmail/Outlook connection rows) and the equivalent spot on the Venue Profile page. Three states:

1. **Unsupported browser/platform** — shows the explanatory message from the Platform Reality section above, toggle disabled.
2. **Supported, not yet enabled** — a plain "Enable notifications" toggle. Flipping it on: registers `/sw.js`, calls `Notification.requestPermission()`, and on `"granted"`, calls `pushManager.subscribe()` with the VAPID public key and `POST`s the result to `/api/push/subscribe`. On `"denied"`, shows a message that browser/phone-level settings need to be changed manually to re-enable (browsers don't allow re-prompting once denied).
3. **Supported and enabled** — toggle shows on; flipping it off unsubscribes locally and calls `DELETE /api/push/subscribe`.

On mount, the component checks for an existing subscription (`registration.pushManager.getSubscription()`) to render the correct initial state rather than always defaulting to "off."

## Edge Cases

- **A user with the toggle on but zero remaining subscriptions** (e.g. deleted the app from their only device without ever toggling off in-app): `sendPushToUser` simply finds no rows and sends nothing — no error, no special handling needed.
- **The same physical device enabling twice** (e.g. reinstalling the PWA): the `endpoint` unique constraint plus the upsert-on-conflict means this cleanly replaces the old row rather than creating a duplicate.
- **A push send failing for a reason other than 404/410** (network blip, malformed payload): logged, subscription row is left alone — a transient failure shouldn't cause someone to silently stop receiving alerts.
