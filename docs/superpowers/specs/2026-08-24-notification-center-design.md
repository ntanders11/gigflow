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
| `rating_available` | The artist if they haven't rated yet, the venue if they haven't rated yet (either, both, or — rarely — neither, per `maybeSendNewGigToRateEmails`'s existing per-party checks) | `app/api/gigs/[id]/route.ts`, alongside that call | `/ratings` or `/venue/ratings` (per recipient) |
| `rating_revealed` | Both artist and venue | `app/api/ratings/route.ts` and `app/api/venue/ratings/route.ts`, alongside each `sendRatingRevealedEmail` call | `/ratings` or `/venue/ratings` (per recipient) |
| `follow_up_sent` | Artist | `app/api/venues/follow-up/route.ts`, alongside the successful `sendArtistEmail` call (~line 112) | `/pipeline` |

For `rating_available`, mirror `maybeSendNewGigToRateEmails`'s existing per-party logic exactly (`lib/email/rating-notifications.ts:28-102`): it independently emails the artist when they haven't rated yet, and separately emails the venue when they haven't rated yet — so a given gig completion can notify one party, both, or neither. Create a notification for the same party(ies) it emails, using the same condition, not a new independent check.

## Data Model

New table (migration `supabase/migrations/021_notifications.sql`):

```sql
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
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

create index idx_notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;
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

Implement the insert using the same non-throwing `{ data, error }` check pattern already used everywhere in this codebase (never `.throwOnError()` or a manual `throw`) — log `error` if present and return normally either way, so a bad insert genuinely cannot raise an exception. Call `createNotification` in its own `try/catch`, separate from (not nested inside) the existing email-send `try/catch` at each site — so a notification failure never affects whether the email sends, and an email failure never blocks the notification from being created.

For venue-directed notifications, the caller resolves `venue_profile_id` → the venue's real `user_id` first (a one-row lookup against `venue_profiles`, the same resolution `lib/email/booking-request-notifications.ts:57-63` and `lib/email/rating-notifications.ts:54-58,113-117` already do to build their own emails) and passes that resolved id as `userId` — `createNotification` itself never takes a `venue_profile_id`, only a real user id, so it stays identical regardless of which side is being notified.

## Reading Notifications

Two new endpoints:

- `GET /api/notifications` — auth required. Returns `{ notifications: NotificationView[], unreadCount: number }` for the caller's own `user_id`, most recent 20, newest first.
- `PATCH /api/notifications/mark-read` — auth required, no body. Sets `read_at = now()` on every currently-unread row for the caller. (Matches the confirmed behavior: opening the dropdown clears the whole unread count at once — no per-notification granularity needed for v1.)

`types/index.ts` gains `NotificationType` (the six string literals above) and `NotificationView` (`id`, `type`, `title`, `body`, `link`, `read: boolean`, `created_at`).

## UI

New `components/notifications/NotificationBell.tsx` — a bell icon with a small unread-count badge (same visual language as the badges it replaces), used in both `components/layout/Sidebar.tsx` (desktop sidebar **and** `MobileBottomNav` — the mobile nav currently has no badge concept at all, so this is new there, not a replacement) and `components/venue/VenueNav.tsx`. Clicking the bell opens a dropdown of the fetched notifications (title + relative time, unread ones visually distinct until the dropdown opens); clicking an individual notification navigates to its `link`. Opening the dropdown fires the mark-read PATCH once, immediately.

**Replaces** (removed entirely, per Taylor's explicit choice to consolidate rather than keep both): `Sidebar.tsx`'s `pendingRatingsCount`/`pendingBookingRequestsCount` state, fetch effects, and badge rendering on the Calendar/Ratings links; `VenueNav.tsx`'s `pendingRatingsCount` state, fetch, and badge on the `/venue/ratings` link. Those pages themselves are untouched — only the nav-level badge numbers go away, replaced by the one bell.

**Refresh behavior:** fetch on mount, matching the simple one-shot pattern `VenueNav.tsx`'s ratings badge already uses today. On the artist side (`Sidebar.tsx`), also listen for the two existing custom events it already dispatches/listens for (`stagereach:profile-updated`, `stagereach:booking-request-updated`) and refetch on either, so the artist's bell updates live within the same tab after an accept/decline — consistent with the existing pattern, no new event types introduced. **These two events are only ever dispatched from artist-side code today** (`app/(protected)/artist-profile/page.tsx`, `components/calendar/BookingRequestsSection.tsx`) — the venue-side bell in `VenueNav.tsx` has no equivalent to listen for, so it only refreshes on mount/page navigation, not live within a tab. This is an accepted asymmetry for v1, not an oversight: a venue accepting/declining nothing themselves (they only receive accept/decline notifications, they don't trigger them) means the gap mainly shows up as "the venue's unread count doesn't update until they next navigate," which the mark-read-on-open behavior below already handles reasonably.

**Known trade-off — unread count vs. the badges it replaces:** the two existing badges (`Sidebar.tsx`'s ratings/booking counts, `VenueNav.tsx`'s ratings count) are *live pending-item counts* that self-correct the moment the underlying item resolves (e.g., accepting a booking from `/calendar` directly drops that badge's number immediately, with no need to open anything). The new bell's unread count only clears via the mark-read PATCH fired when the dropdown opens — so if someone resolves something without opening the bell first, the badge can keep showing an unread count for an item that's already been dealt with, until they open the dropdown. This is a direct consequence of the "opening it clears everything" behavior already chosen for this feature, not a new decision — flagging it here so it's an understood trade-off rather than a surprise once built.

## Edge Cases

- A user with zero notifications: bell shows no badge, dropdown shows a plain "Nothing yet" message.
- `createNotification` failing (e.g. a bad `userId`) never blocks the email send or the action it's attached to — logged server-side, nothing surfaced to the end user.
- A notification whose `link` points to a page the recipient can no longer reach (e.g. a booking request notification for a request that's since been superseded) still navigates there; that page's own existing empty/not-found handling applies — no special-casing needed here.
