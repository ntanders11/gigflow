# Notification Center — Design Spec

**Status:** Approved by Taylor (2026-08-24)

## Background

Every "something happened" moment in StageReach today — a new booking request, a booking getting accepted or declined, a rating becoming available or revealing, the automated 5-day follow-up email — only ever reaches the user as an email (via `lib/email/booking-request-notifications.ts`, `lib/email/rating-notifications.ts`, and the follow-up cron in `app/api/venues/follow-up/route.ts`). There's no in-app record of any of it. The closest thing today is two narrow, single-purpose badge counts: `components/layout/Sidebar.tsx`'s `pendingRatingsCount`/`pendingBookingRequestsCount` (on the artist side) and `components/venue/VenueNav.tsx`'s `pendingRatingsCount` (venue side) — both scoped to "things awaiting your action," not a general activity feed, and neither covers accept/decline responses or the follow-up cron at all.

This spec covers the first of two planned pieces: an in-app notification center (a bell icon with a dropdown list). Real push notifications to the phone's lock screen are an explicitly separate follow-up project, to be built on top of this once it's live — not part of this spec.

## Non-Goals

- Push notifications (phone lock-screen alerts) — separate future project.
- Per-notification delete/archive UI, or pagination beyond a simple "most recent" list.
- Changing anything about the existing email-sending behavior — every current email keeps sending exactly as it does today; this spec only adds an in-app record alongside each one.
- A settings UI for choosing which notification types to receive — everyone gets all types for v1.

## What Counts as a Notification (v1)

Six events, one row created per recipient per event:

| Type | Recipient(s) | Triggered from | Links to |
|---|---|---|---|
| `booking_request_received` | Artist | `app/api/venue/booking-requests/route.ts` (POST, after the insert, alongside the existing `sendNewBookingRequestEmail` call) | `/calendar` |
| `booking_request_accepted` | Venue | `app/api/booking-requests/[id]/route.ts` (PATCH, accept path, alongside `sendBookingResponseEmail(..., "accepted")`) | `/venue/bookings` |
| `booking_request_declined` | Venue | Same file, decline path, alongside `sendBookingResponseEmail(..., "declined")` | `/venue/bookings` |
| `rating_available` | Whichever party(ies) `maybeSendNewGigToRateEmails` currently emails | `app/api/gigs/[id]/route.ts`, alongside that call | `/ratings` or `/venue/ratings` (per recipient) |
| `rating_revealed` | Both artist and venue | `app/api/ratings/route.ts` and `app/api/venue/ratings/route.ts`, alongside each `sendRatingRevealedEmail` call | `/ratings` or `/venue/ratings` (per recipient) |
| `follow_up_sent` | Artist | `app/api/venues/follow-up/route.ts`, alongside the successful `sendArtistEmail` call (~line 112) | `/pipeline` |

For `rating_available`, mirror exactly who `maybeSendNewGigToRateEmails` emails today — read that function's body at implementation time rather than assuming; don't notify a party who isn't already being emailed for this event.

## Data Model

New table (migration `supabase/migrations/021_notifications.sql`):

```sql
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in (
    'booking_request_received', 'booking_request_accepted', 'booking_request_declined',
    'rating_available', 'rating_revealed', 'follow_up_sent'
  )),
  title text not null,
  body text,
  link text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_user_unread on notifications (user_id, created_at desc) where read_at is null;
```

`user_id` is always the recipient's real auth user id (matches `profiles.id`) — the same identity a venue account logs in with, not `venue_profile_id`. Follows the existing convention: `status`/`type` as a plain `text` + `check` constraint (matching `booking_requests.status`), not a Postgres enum type. No RLS policies — same reasoning as `booking_requests` and `venue_artist_ratings`: every write happens server-side already knowing exactly who the recipient is, and reads are scoped by the authenticated caller's own id, so client-facing RLS adds nothing a service-role route with an explicit `.eq("user_id", ...)` doesn't already guarantee.

## Creating Notifications

New shared helper, `lib/notifications/create.ts`:

```typescript
export async function createNotification(
  service: SupabaseClient,
  params: { userId: string; type: NotificationType; title: string; body?: string; link: string }
): Promise<void>
```

A plain insert; swallow and log errors internally (a failed notification insert must never block the email send or the underlying action it's attached to — same "non-critical" treatment `DiscoverView.tsx`'s enrichment step already uses for its own side-effects).

For venue-directed notifications, the caller resolves `venue_profile_id` → the venue's real `user_id` first (a one-row lookup against `venue_profiles`, the same resolution `app/api/venue/ratings/route.ts`'s `getOwnVenueProfileId`-style pattern already does elsewhere) and passes that resolved id as `userId` — `createNotification` itself never takes a `venue_profile_id`, only a real user id, so it stays identical regardless of which side is being notified.

## Reading Notifications

Two new endpoints:

- `GET /api/notifications` — auth required. Returns `{ notifications: NotificationView[], unreadCount: number }` for the caller's own `user_id`, most recent 20, newest first.
- `PATCH /api/notifications/mark-read` — auth required, no body. Sets `read_at = now()` on every currently-unread row for the caller. (Matches the confirmed behavior: opening the dropdown clears the whole unread count at once — no per-notification granularity needed for v1.)

`types/index.ts` gains `NotificationType` (the six string literals above) and `NotificationView` (`id`, `type`, `title`, `body`, `link`, `read: boolean`, `created_at`).

## UI

New `components/notifications/NotificationBell.tsx` — a bell icon with a small unread-count badge (same visual language as the badges it replaces), used in both `components/layout/Sidebar.tsx` (desktop sidebar **and** `MobileBottomNav` — the mobile nav currently has no badge concept at all, so this is new there, not a replacement) and `components/venue/VenueNav.tsx`. Clicking the bell opens a dropdown of the fetched notifications (title + relative time, unread ones visually distinct until the dropdown opens); clicking an individual notification navigates to its `link`. Opening the dropdown fires the mark-read PATCH once, immediately.

**Replaces** (removed entirely, per Taylor's explicit choice to consolidate rather than keep both): `Sidebar.tsx`'s `pendingRatingsCount`/`pendingBookingRequestsCount` state, fetch effects, and badge rendering on the Calendar/Ratings links; `VenueNav.tsx`'s `pendingRatingsCount` state, fetch, and badge on the `/venue/ratings` link. Those pages themselves are untouched — only the nav-level badge numbers go away, replaced by the one bell.

**Refresh behavior:** fetch on mount, matching the simple one-shot pattern `VenueNav.tsx`'s ratings badge already uses today. Additionally listen for the two existing custom events `Sidebar.tsx` already dispatches/listens for (`stagereach:profile-updated`, `stagereach:booking-request-updated`) and refetch on either, so the bell updates live within the same tab after an accept/decline — consistent with the existing pattern, no new event types introduced. Events with no existing custom-event hook (a rating revealing, a follow-up sending) only refresh on the next mount/page load, same as `VenueNav`'s ratings badge does today — no new live-refresh infrastructure for those.

## Edge Cases

- A user with zero notifications: bell shows no badge, dropdown shows a plain "Nothing yet" message.
- `createNotification` failing (e.g. a bad `userId`) never blocks the email send or the action it's attached to — logged server-side, nothing surfaced to the end user.
- A notification whose `link` points to a page the recipient can no longer reach (e.g. a booking request notification for a request that's since been superseded) still navigates there; that page's own existing empty/not-found handling applies — no special-casing needed here.
