# In-app messaging between venues and artists — design

Date: 2026-10-06. Status: approved in conversation, awaiting written-spec review.

## Goal

Let venues and artists talk inside StageReach (pay, set length, load-in, interest) before or alongside a booking request, so the conversation lives next to the booking instead of in email.

## Rules (enforced server-side, not just by hiding buttons)

1. **Only a venue can start a conversation**, via a "Message" button next to "Request to Book" on an artist's public `/profile/[id]` (venue viewers only).
2. **An artist can only reply** inside a conversation a venue already started. There is no "message this venue" entry point on the artist side — artists email venues (existing pitch flow) for first contact. This is deliberate: venues must not be spammed.
3. **One conversation per venue/artist pair** (unique on `venue_profile_id` + `artist_user_id`). If a booking request exists between them, the thread shows it pinned at the top (looked up at read time, not stored on the conversation).
4. **Block**: either side can block the other. While a conversation is blocked, neither side can send; the blocker still sees history. Only the person who blocked can unblock.
5. **Report**: either side can report a message; the report emails Taylor (same pattern as rating reports). No in-app moderation UI.
6. Message text is length-capped (2,000 characters). A message may also carry **one attachment** (see Attachments). No read receipts, typing indicators, or group chats.

## Data model (migration `030_messaging.sql`)

Both tables: RLS enabled with **no policies**; every read/write goes through server routes using the service-role client (same as `booking_requests` and `venue_artist_ratings`). Migration ends with the three standard grants (`anon`, `authenticated`, `service_role`), per the Data API grants rule in CLAUDE.md.

- `conversations`: `id`, `venue_profile_id`, `artist_user_id`, `last_message_at`, `blocked_by` (nullable: `'artist' | 'venue'`), `created_at`. Unique on (`venue_profile_id`, `artist_user_id`).
- `messages`: `id`, `conversation_id`, `sender_type` (`'artist' | 'venue'`), `sender_user_id`, `body` (may be empty if an attachment is present), `created_at`, `read_at` (nullable), plus nullable attachment fields `attachment_path`, `attachment_name`, `attachment_type`, `attachment_size`. A message must have a body, an attachment, or both.
- Email preference: a single `message_emails_enabled boolean not null default true` column on `profiles`, used for everyone (artists and venues).

## Attachments

For things like stage plots, parking maps, and rider sheets.

- **Allowed**: images (JPEG, PNG, WebP, GIF) and PDFs, **max 10 MB each**, one per message. Nothing else.
- **Private storage**: a new private Supabase Storage bucket `message-attachments` (not the public `artist-photos` bucket the photo upload uses). Files are stored under `<conversation_id>/<random-uuid>-<sanitized name>`. Nobody gets a permanent public URL; the thread endpoint returns short-lived signed URLs, and only to the two participants of that conversation.
- **Validation is server-side**: type (checked against an allowlist, and the real content type, not just the file extension), size, participant membership, and block status. Neither side can upload while the conversation is blocked. Original filenames are sanitized before use in the storage path.
- **Upload flow** (signed URL): `POST /api/messages/conversations/[id]/attachments` validates the declared type and size and returns a server-issued signed upload URL; the client uploads the file directly to storage with it, then includes the attachment fields in the send request, where the server re-checks the stored file. If the send never happens, an orphaned file may remain (acceptable at this scale; revisit with a cleanup job if it grows).
- **Display**: images preview inline in the thread (tap to enlarge); PDFs show as a file chip with name and size that opens in a new tab.
- The private `message-attachments` bucket is created by the migration itself; no manual dashboard step.

## Routes

- `GET /api/messages/conversations` — caller's conversations with last message and unread count.
- `POST /api/messages/conversations` — venue only; creates (or returns existing) conversation with an artist and optionally sends the first message.
- `GET /api/messages/conversations/[id]` — messages in a thread; marks the other side's messages read.
- `POST /api/messages/conversations/[id]/messages` — send (text, attachment fields, or both); rejects if blocked, or if caller is an artist and the conversation doesn't exist.
- `POST /api/messages/conversations/[id]/attachments` — validate an attachment and return a signed upload URL (see Attachments).
- `POST /api/messages/conversations/[id]/block`, `/unblock` (only by the person who blocked), and `/report`.
- `GET`/`PATCH /api/messages/preferences` — read and save `message_emails_enabled` (not via the profile PATCH routes).

## Pages and navigation

- Artist: `/messages` (list + thread). No new tab — the artist mobile bar stays at 5. A "Unread messages" card on `/dashboard` and the notification bell link there.
- Venue: `/venue/messages`. **On the venue mobile bottom bar, Messages replaces Invoices** (Dashboard, Discover, Bookings, Messages, Profile), with an unread-count badge. Desktop top bar gets Messages too. Invoices stays reachable: `/venue/invoices` still exists, and the venue Dashboard's "Outstanding invoices" card links to it. Venue Dashboard also gets an "Unread messages" card.
- Each venue page already carries `pb-28 md:pb-0` to clear the bottom bar — no layout change needed.

## Alerts

- New message creates an in-app notification (`NotificationType` gains `message_received`) and a push, both always on — added to the pushable set in `lib/notifications/create.ts`.
- **Email nudge**: sent only for the first unread message in a thread (not one per message), via the shared sender using the same pattern as `lib/email/booking-request-notifications.ts`. Skipped when the recipient's `message_emails_enabled` is false.
- **Opt-out toggle**: "Email me about new messages" on the Artist Profile and Venue Profile pages, beside `PushToggle`. In-app and push alerts are not affected by it.

## Errors / edge cases

- Artist tries to start a conversation → 403.
- Send while blocked (either side) → 403 with a plain message. Duplicate "start conversation" → returns the existing one.
- Disallowed file type or over 10 MB → 400 with a plain message. Signed links expire, so the thread re-fetches them on load.
- Email failure never blocks a send (log and move on, like other notification emails).

## Testing

`npm test` runs Vitest for the pure rules (attachment limits and similar); everything else is verified manually. Verify manually on localhost with a venue account and an artist account: venue starts a thread, artist replies, unread badges update, block stops sends, opt-out suppresses the email, artist cannot start a thread, attachments upload and preview, oversized/disallowed files are rejected, and someone outside the conversation can't get a link to the file (signed links last an hour for the two participants).

## Out of scope (separate small task)

**App-icon badge** (Badging API on the installed PWA, like Instagram). Requires counting all unread notification types, not just the three currently pushed, and only updates on push receipt or app open; iOS needs 16.4+ with the app on the home screen and notifications allowed. Tracked separately from messaging.

## Open items

None blocking. Later: audio/other file types, artist-initiated messaging if ever wanted, a notification-count badge on the app icon.
