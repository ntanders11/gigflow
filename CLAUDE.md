# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## User Context

The person building GigFlow is **Taylor Anderson** — a musician based in Newberg, OR. Taylor is **non-technical** and is not a developer. Claude is acting as the primary engineer on this project.

When communicating with Taylor:
- Avoid jargon and technical acronyms without explanation
- Explain *what* something does before *how* it works
- Prefer plain-language summaries over code snippets in responses
- If a decision has trade-offs, present them in terms of user-facing outcomes, not implementation details

## Claude's Maintenance Responsibilities

Claude is responsible for keeping the following files accurate and up-to-date — automatically, without being asked — after any session that changes the codebase, architecture, or project direction:

### CLAUDE.md (this file)
Update whenever:
- New routes, API endpoints, or pages are added
- The data model changes (new tables, fields, or relationships)
- Key flows change (auth, pipeline, import, etc.)
- New environment variables are required
- New libraries or major dependencies are introduced

### CHANGELOG.md (create if it doesn't exist)
After every session that produces meaningful changes, append an entry in this format:
```
## YYYY-MM-DD
- [Feature/Fix/Change] Brief description of what changed and why
```
Keep entries user-facing and plain-language — not git commit messages.

### SESSION_LOG.md
If a session involves significant decisions, research, or direction changes (not just routine code), append a brief summary: what was discussed, what was decided, and what was left open.

## Commands                                                                                                                                                       
                                                            
  ```bash
  npm run dev      # Start development server
  npm run build    # Build for production
  npm run lint     # Run ESLint                                                                                                                                     
   
  No test suite is currently configured.                                                                                                                            
                                                            
  Architecture

  GigFlow is a musician's CRM for managing venue booking pipelines — built as a full-stack Next.js App Router application with Supabase as the backend.             
   
  Core Data Model                                                                                                                                                   
                                                            
  - Zone — geographic region (zip code + radius) that belongs to a user; container for venues
  - Venue — music venue with contact info, pipeline stage, and confidence level
  - Interaction — logged contact event (email, call, in-person, note, reply, follow_up) tied to a venue
  - Gig — a booked performance tied to a venue (date, start/end time, notes, 7-item prep checklist, status). Powers the Booking Calendar.
  - Invoice — a Stripe-backed invoice tied to a venue (amount_cents, payment_type: full/deposit, status: draft/sent/paid/void, stripe_invoice_id, stripe_invoice_url). Created from either a venue's detail page or the Invoices page.
  - artist_profiles — artist/EPK profile (user_id → profiles.id, display_name, phone, bio, social_links jsonb, photo_url). display_name is the authoritative artist name used in emails and the pipeline. Written by the onboarding wizard.
  - invite_codes — reusable beta access codes (code, active). No RLS — queried only via service role from /api/auth/validate-code.
  - email_connections — an artist's connected Gmail or Outlook account for sending pitch/follow-up emails from their own address (provider, connected_email, tokens, status: active/needs_reconnect). One row per artist per provider.
  - venue_profiles — a venue's own account (separate from the private `venues` rows inside an artist's pipeline). venue_name is null until signup finishes. A unique index on (venue_name, city) prevents duplicate claims. Linked from the artist side via the new nullable `venues.venue_profile_id` column.
  - venue_artist_ratings — double-blind mutual rating between a venue account and an artist, one row per relationship holding both sides' halves (venue_stars/venue_review/venue_rated_at, artist_stars/artist_review/artist_rated_at). "Revealed" (both halves visible to each other, and shown publicly) is computed at read time — true once both `*_rated_at` are set. No client-facing RLS policies; every read/write goes through a server route using the service-role client. A rating opportunity requires a completed gig at a venue linked to a real account (see `venues.venue_profile_id`), and is limited to one per relationship ever, not per gig.
  - booking_requests — a venue's date/time request to an artist, with its own pending/accepted/declined lifecycle independent of the artist's Gig calendar. No client-facing RLS policies; every read/write goes through a server route using the service-role client (same reasoning as venue_artist_ratings — RLS can't restrict which columns a party writes, only which rows). Accepting creates a real Gig (see `gig_id`) and, if needed, a linked pipeline `venues` row for that venue under that artist.
                                                                                                                                                                    
  Pipeline stages (in order): discovered → contacted → responded → negotiating → booked (dormant is a side state, not part of the linear flow)
                                                                                                                                                                    
  Types are defined in types/index.ts.                      

  Key Flows

  Authentication — proxy.ts is the Next.js middleware. It uses the Supabase SSR client (cookie-based sessions) to protect all routes except /login, /signup, /venues, /venues/signup, /profile/[id] (public artist profile), /api/calendar/ics, /api/auth/validate-code, and /api/auth/confirm. It also checks whether a logged-in user is a venue account (has a venue_profiles row) before the artist-onboarding check — see Venue Accounts below.

  Email Confirmation — the Supabase browser client (lib/supabase/client.ts) uses the PKCE auth flow, which means a confirmation email's link carries a one-time code that must be explicitly exchanged for a session — nothing happens automatically just from the link being clicked. GET /api/auth/confirm is that exchange point: every signup flow's emailRedirectTo points here (as `/api/auth/confirm?next=<destination>`), which calls `supabase.auth.exchangeCodeForSession(code)` server-side (setting the real session cookie) and then redirects on to `next` (`/onboarding` for artists, `/venues/signup` for venues). Without this route, clicking a confirmation link does nothing — discovered and fixed 2026-08-14 after live testing found new signups couldn't actually complete for either account type.

  Multi-User Sign-up — /signup (public) validates an invite code then creates a Supabase auth user, with emailRedirectTo pointed at /api/auth/confirm?next=/onboarding (see Email Confirmation above) so confirmation links exchange correctly and never land on localhost. A SECURITY DEFINER DB trigger (handle_new_user) auto-creates a profiles row on auth.users INSERT. New users are then routed to /onboarding to complete their profile.

  Onboarding Wizard — /onboarding is a 5-step client-side wizard collecting artist name/phone (step 1), home region (step 2), social links (step 3), bio/photo (step 4), and connecting a personal Gmail/Outlook account (step 5, required — see Personal Email Sending). The profile and zone are saved when moving from step 4 to step 5 (not at the very end), since step 5 involves a full-page redirect to Google/Microsoft that would otherwise lose in-progress data. Photo upload is non-blocking — failures don't stop onboarding. Step 5 has no upfront skip; a short-lived cookie tags the next OAuth attempt as belonging to onboarding. The Artist Profile page clears this cookie whenever it observes any OAuth outcome (success or failure); on failure specifically, if the cookie was present it redirects back to this step instead of showing its own error banner, so a failed connection during onboarding always returns the artist to the wizard's fallback, not a generic profile-page error. (The "Continue without connecting for now" link on this page also clears the cookie itself, covering the case where an artist retries after a failure and then explicitly skips rather than triggering another OAuth round trip.) The middleware checks for artist_profiles.display_name and routes incomplete users back to /onboarding.                 
   
  Kanban Pipeline — app/pipeline/page.tsx fetches all venues for the current user and renders components/pipeline/KanbanBoard.tsx, which uses @hello-pangea/dnd for 
  drag-and-drop. Stage changes optimistically update local state, then PATCH /api/venues/[id] — rolling back on failure. Includes single-venue and batch pitch/follow-up email sending, with a select mode and floating send bar. Sending goes through lib/email/send-artist-email.ts, which uses the artist's connected Gmail/Outlook if present and falls back to the shared Resend sender otherwise (see Personal Email Sending below).
                                                                                                                                                                    
  Venue Detail — components/venue/VenueDetail.tsx handles stage changes, contact info editing, notes (saved on blur), logging interactions (POST                
  /api/interactions, which also updates last_contacted_at), invoice creation/deletion, and gig scheduling. Pitch/follow-up sends here also go through lib/email/send-artist-email.ts (see Personal Email Sending below).
                                                                                                                                                                    
  Discover Venues — components/discover/DiscoverView.tsx auto-searches on load using the user's home zone. GET /api/venues/discover geocodes the city server-side (Google Geocoding first, Geoapify Geocoding then Nominatim as fallbacks) then queries Google Places Nearby Search (bar/night_club/winery/brewery, one combined call) and Geoapify Places concurrently, merging and deduplicating the results by name (Google's version wins on collisions — richer data). Google's primaryType filter is precise but strict, so a search often only turns up 1-2 matches from Google alone; Geoapify fills in the rest rather than being a "Google failed" fallback. OpenStreetMap Overpass is the last resort if both come up empty. Google results are filtered on `primaryType` (not the full `types` array) — otherwise things like Topgolf or a bowling alley sneak in just because they also serve alcohol. Google's `live_music_venue` place type is surfaced as a "🎵 Live music confirmed" badge when present. Search is deliberately scoped to small, informal venues — no concert halls, theaters, universities, or event venues, which book through a different channel than a bar or club does. Venues already in the user's pipeline are silently excluded from results (no greyed-out duplicates). The page also displays "Powered by Geoapify" + OpenStreetMap attribution, required since Geoapify is now used on every search, not just as backup.

  CSV Import — app/venues/import/page.tsx uploads a file to POST /api/venues/import, which parses it via lib/csv-parser.ts (no external library), validates fields, 
  and bulk-inserts using the Supabase service client (bypassing RLS). Expected CSV columns: Venue Name, Type, City, Zone, Confidence, Website, Live Music Details,
  Contact, Phone. Venues can also be exported back to CSV for sharing with another artist.

  Invoicing (Stripe) — InvoiceModal (components/invoice/InvoiceModal.tsx) creates a draft invoice via POST /api/invoices, then sends it via POST /api/invoices/[id]/send, which creates/reuses a Stripe customer, builds a real Stripe invoice + line item, finalizes it, and emails the venue a hosted "Pay Now" link. app/api/stripe/webhook/route.ts listens for invoice.paid and auto-marks the local invoice as paid. DELETE /api/invoices/[id] removes an invoice — if it was sent and not yet paid, it's also voided on Stripe's side first. The Invoices page (app/(protected)/invoices/page.tsx) lists all invoices across every venue and has its own "New Invoice" button with a venue picker (components/invoice/CreateInvoiceButton.tsx).

  Automated Follow-ups — app/api/venues/follow-up/route.ts, triggered by a Vercel cron job (protected by CRON_SECRET), automatically sends one follow-up email to any venue that's been in "contacted" for 5+ days with no reply. This send also goes through lib/email/send-artist-email.ts (see Personal Email Sending below).

  Personal Email Sending — Artists can connect Gmail or Outlook from the Artist Profile page's "Connected Accounts" section (app/api/auth/gmail/connect, app/api/auth/callback/gmail, and the same for outlook). Once connected, all pitch/follow-up sends (manual, batch, and the automated cron) go out from the artist's real address via lib/email/send-artist-email.ts, which handles token refresh and falls back to the shared Resend sender automatically if nothing is connected or a send fails. Connections and tokens live in the email_connections table (supabase/migrations/014_email_connections.sql). Requires Taylor to first create a Google OAuth client (Google Cloud Console) and grant Mail.Send admin consent for the existing Azure app registration before either provider can actually be connected — see the implementation plan's Tasks 6–7 for exact steps.

  Outlook Calendar Connect — app/api/auth/outlook/connect and app/api/auth/callback/outlook implement an Azure AD OAuth flow (now also requesting Mail.Send, shared with Personal Email Sending above) so gigs can sync to a musician's Outlook calendar via app/api/calendar/sync. Tokens are stored in the email_connections table (not cookies) so they can be refreshed server-side. app/api/calendar/ics exposes a public .ics feed as an alternative.

  Diagnostics — /api/email-status and /api/stripe-status (both require login) return a plain-language report of whether email sending and Stripe payouts are correctly configured. /api/email-status also reports the logged-in artist's personal Gmail/Outlook connection status (if any) and which one sending will actually use, alongside the shared Resend checks. Useful for debugging delivery/payment issues without digging through provider dashboards.

  Venue Accounts — venues get their own accounts, entirely separate from artist accounts. `/venues` is a public landing page; `/venues/signup` is a 4-step wizard (create account → search existing pipeline entries → claim or start fresh → fill in profile details). Signup is open, no invite code. Searching (`GET /api/venues/search-existing`) and the "linking sweep" that runs once a venue's name is saved (`PATCH /api/venue-profile`) both use the service-role client to read/write across every artist's private `venues` rows — the same pattern the CSV import route uses — since RLS otherwise scopes `venues` to its owning artist. The linking sweep sets `venue_profile_id` on every matching pipeline row across every artist, not just the one interacted with during claim, which is what powers the "⭐ On StageReach" badge shown on pipeline cards (`components/venue/VenueCard.tsx`), the venue detail page, and Discover Venues search results — where a real StageReach account is also always ranked first. `proxy.ts` checks for a `venue_profiles` row before the artist-onboarding check, so venue accounts never get misrouted into the artist onboarding wizard. Logged-in venues manage their profile at `/venue/profile`. The second piece, artist discovery, adds `/venue/discover` — a venue-side search over StageReach's own `artist_profiles` (not an external API), reusing the same geocoding (`lib/geocoding.ts`, shared with the artist-side Discover Venues route) and the same city/radius UX. Results are split into two tiers by comparing the venue's own `genres` against each artist's `genres` (case-insensitive, trimmed) — matches first, everyone else in the searched radius below; venues with no genres set just see one flat list. Artist zone coordinates are geocoded once and cached on `zones.lat`/`zones.lon` rather than re-geocoded on every search, since Google Geocoding is capped at 200 calls/day project-wide — and a zone whose name fails to geocode entirely gets marked `geocode_failed` so it's skipped on future searches instead of being silently retried (and re-failing) every time. Each result links straight to that artist's existing public `/profile/[id]` page — no new artist-detail view was built. A new `VenueNav` header (`components/venue/VenueNav.tsx`) gives venues their first real navigation between "My Profile" and "Discover Artists".

  Mutual Ratings — the third piece of the venue portal. Once an artist marks a gig `completed` at a venue linked to a real account (`venues.venue_profile_id` set), both sides can rate each other 1-5 stars with an optional written review, at `/ratings` (artist) or `/venue/ratings` (venue). Ratings are double-blind — neither side sees the other's half until both have submitted — and editable any time afterward, including post-reveal. Two emails keep the loop moving: one when a gig completes and a new rating becomes available (`PATCH /api/gigs/[id]` → `lib/email/rating-notifications.ts`), one when the second half is submitted and the relationship reveals. Revealed ratings show publicly on the artist's existing `/profile/[id]` page and a new public venue page at `/venues/profile/[id]` (distinct from the private `/venue/profile` and the existing private `/venues/[id]` pipeline-detail page — note the different path shapes), plus as a small badge on both Discover Venues and Discover Artists result cards. Either party can report a revealed rating; reports email Taylor directly rather than going through any in-app moderation UI. Both artists and venues can now pick up to 3 of their favorite received reviews to feature at the top of their public profile via toggles on their ratings page (`/ratings` or `/venue/ratings`), with all other reviews available behind a "Load more reviews" button; this is stored as `featured_by_artist_rank`/`featured_by_venue_rank` on `venue_artist_ratings` (migration `020_featured_reviews.sql`).

  Booking Requests — the fourth and final piece of the venue portal. A venue sends a date/time request from any artist's public profile (`/profile/[id]`, a "Request to Book" button that replaces the old mailto "Send Booking Inquiry" link — venues only; anyone else sees a "sign up as a venue" prompt instead). The request form checks the artist's existing confirmed gigs so a venue doesn't submit a request for an unavailable date. The artist reviews pending requests on their existing Booking Calendar (`/calendar`) and accepts or declines. Accepting finds-or-creates a linked pipeline entry for that venue (reusing the same "default zone" pattern Discover Venues' add-to-pipeline flow already uses) and creates a real Gig on it — from that point on it behaves exactly like any other gig, including eventual mutual-ratings eligibility once marked completed. Venues track every request they've sent, and its status, at `/venue/bookings`. Two emails (`lib/email/booking-request-notifications.ts`) keep both sides informed, using the same shared-sender/`profiles.email` pattern as the ratings notifications.

  Notification Center — a `notifications` table (migration `021_notifications.sql`, RLS enabled with no policies; service-role only) covers six events previously only surfaced via email: booking request received/accepted/declined, rating becoming available, rating relationship revealing, and automated follow-up sent. Each event creates a row via `lib/notifications/create.ts`'s `createNotification` alongside the existing email send. Notifications are read via `GET /api/notifications` / `PATCH /api/notifications/mark-read` and displayed via a shared `components/notifications/NotificationBell.tsx` on both the artist nav (`Sidebar.tsx`, desktop and mobile) and venue nav (`VenueNav.tsx`) — which replaced the narrower `pendingRatingsCount`/`pendingBookingRequestsCount` badges those navs used to compute independently.
                                                            
  Supabase Clients

  - lib/supabase/server.ts — createClient() (cookie-based, respects RLS) and createServiceClient() (service role, bypasses RLS — used for cross-user reads/writes like CSV import, venue signup search, and the linking sweep). createServiceClient() deliberately does NOT use the @supabase/ssr cookie-aware helper, even though it looks like the natural choice — that helper recovers and reuses a session from cookies, and once a session exists, supabase-js authenticates requests as that session instead of the key passed at construction, silently defeating RLS bypass with no error. Discovered via live testing 2026-08-14 (cross-artist venue search was returning zero results despite matching data existing). Fixed by building it on the plain @supabase/supabase-js createClient() instead, with no cookie awareness and persistSession/autoRefreshToken both off.
  - lib/supabase/client.ts — browser-side client
                                                                                                                                                                    
  Path Aliases
                                                                                                                                                                    
  @/* maps to the repo root — use @/components/..., @/lib/..., @/types/... for imports.

  Environment Variables

  Required in .env.local (and in Vercel's project settings for production):
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY                                                                                                                                   
  - SUPABASE_SERVICE_ROLE_KEY                               
  - RESEND_API_KEY / RESEND_FROM_EMAIL — email sending (pitch/follow-up/invoice emails). Fully wired up; the sending domain must be verified with Resend (SPF/DKIM) or mail lands in spam.
  - STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET — invoicing. The account's own bank/payout setup is managed entirely in the Stripe Dashboard, not in this codebase.
  - GOOGLE_PLACES_API_KEY — primary venue discovery (Places Nearby Search) and geocoding. Requires billing on the Google Cloud project; a hard daily request quota (200/day on both Places API (New) and Geocoding API, set in Cloud Console → APIs & Services → Quotas) caps worst-case spend at roughly $32/month even under runaway/abuse traffic. Normal usage is expected to stay within the free monthly allowance (5,000 Places calls, 10,000 Geocoding calls) and cost $0.
  - GEOAPIFY_API_KEY — automatic fallback for venue discovery and geocoding if Google is ever unavailable. Free tier, no billing required.
  - CRON_SECRET — authorizes the Vercel cron job that triggers automated follow-ups
  - AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID — Outlook OAuth (calendar sync and, as of the Mail.Send scope addition, personal email sending)
  - GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET — Gmail OAuth client (separate from GOOGLE_PLACES_API_KEY, which is a plain API key, not an OAuth client) for personal email sending. Created in the same Google Cloud project, under APIs & Services → Credentials.
  - NEXT_PUBLIC_APP_URL — base URL used for building absolute links (e.g. calendar/OAuth redirects)