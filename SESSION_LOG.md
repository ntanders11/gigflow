# StageReach - Session Log

## Session: 2026-05-28 — Batch Email, Domain, Branding

### What Was Built
- **Batch pitch email**: "Send Batch Pitch" button on Pipeline's Discovered column. Select venues with checkboxes (Select All available), preview the email, confirm, and send. Successfully pitched venues auto-advance to Contacted in both local state and the DB.
- **Batch follow-up email**: Same pattern on the Contacted column. Venues already followed up are greyed out and skipped automatically.
- **stagereach.app domain**: Set up as the production URL via Vercel + GoDaddy A/CNAME records.
- **Beta invite link**: `stagereach.app/signup?code=STAGEREACH2026` — the signup page already supported `?code=` params.
- **Email from/reply-to**: All emails send from `booking@stagereach.app` with Reply-To set to the artist's real contact email (from artist profile).
- **Branding**: All "GigFlow" references replaced with "StageReach" across the UI.

### Key Technical Decisions
- Follow-up emails logged as `type: "follow_up"` (new InteractionType value) so batch UI can detect which venues already received one.
- Email template functions extracted to `lib/email-templates.ts` so both PitchEmailModal and BatchEmailModal share the same logic.
- Batch state (mode + selected IDs) lives in PipelineView and threads down through KanbanBoard → KanbanColumn → VenueCard.
- Floating action bar fixed to viewport bottom so it's always visible regardless of scroll position.
- 200ms delay between batch sends to stay within Resend rate limits.

### Left Open
- Nothing critical. The system is working end-to-end.

---

## Session 1 - 2026-03-22 - Initial Brainstorm & Research

### Participants
- Ryan Kee (developer)
- Taylor Anderson (musician, Newberg, OR - end user)

### What Happened
- Brainstormed the concept: a CRM for gigging musicians, inspired by HouseCallPro but for the music booking world
- Defined the core pipeline: Discover venues > Enrich/qualify > Pitch via campaigns > Track pipeline > Book & manage
- Established the data model concept:
  - **Zones** (top-level container, zip code + radius)
  - **Venues** (discovered within a zone)
  - **Campaigns** (outreach runs targeting venues in a zone)
  - **Bookings** (confirmed gigs)
  - **User** (Taylor for now, multi-tenant ready)
- Decided on tech stack: **Next.js + Supabase + Vercel + Resend**
- Ran venue discovery research for proof of concept:
  - 10-mile radius (Newberg/Dundee/McMinnville): 35 venues found (26 HIGH confidence)
  - 10-30 mile radius (outer ring): 59 venues found (28 HIGH confidence)
  - **Total: 94 venues identified, 54 with confirmed live music booking**
- Ran competitive landscape analysis:
  - 16 products analyzed
  - **No single product combines all 5 core features** (venue discovery, outbound campaigns, CRM pipeline, booking calendar, public profile)
  - Closest competitor: Gig App (gig.app) - early stage, mobile-first
  - Clear market gap identified, especially for zone-based territory management and web scraping/enrichment

### Decisions Made
- Build for Taylor first, architect for multi-tenant scale
- Next.js full-stack on Vercel (best for Claude Code maintainability)
- Supabase for database (free tier, web UI, future auth)
- Zone-based data model (not venue-first or campaign-first)
- Google Places API + web scraping hybrid approach for venue discovery

### Open Questions
- Taylor's existing web presence (website, social media, booking platforms)
- Taylor's genre/style/pricing info needed for profile
- Budget for API services (Google Places, email sending)
- Priority features for MVP

### Files Created
- `docs/research/venue-discovery-newberg-10mi.md` - 35 venues within 10mi
- `docs/research/venue-discovery-newberg-30mi.md` - 59 venues in 10-30mi ring
- `docs/research/competitive-landscape.md` - 16 competitors analyzed
- `SESSION_LOG.md` - this file
- `CLAUDE.md` - project overview (TBD after brainstorm completes)

---

## Session 2–4 - 2026-03-22 to 2026-04-07 - Core Build, Deploy, and Dashboard

### What Happened
Built out the full working app across several sessions. GigFlow is now live on Vercel and Taylor can log in and use it.

**Major features shipped:**
- Full kanban pipeline with drag-and-drop (6 stages: Discovered → Contacted → Responded → Negotiating → Booked → Dormant)
- 90+ venues imported, ~26 pitch emails sent
- Automated follow-up emails via Vercel cron (daily 8 AM Pacific) — finds contacted venues with no reply after 5 days, sends one follow-up via Resend
- "They replied ↩" button on Contacted venue cards — one click moves a venue to Responded and updates `last_contacted_at`
- Search filter on the pipeline view (filters by name, city, type, contact name)
- Responsive kanban columns (flex layout, not fixed widths)
- Dashboard "Needs Attention" panel — shows contacted venues with no reply in 5+ days, sorted oldest first
- Dashboard "Booked Gigs" panel — shows all booked venues at a glance
- Dashboard stat cards are now clickable links that filter the pipeline by stage

**Key bugs fixed:**
- Drag-and-drop cards were invisible until scroll — root cause was VenueCard style prop overriding `provided.draggableProps.style`. Fixed by spreading it first.
- TypeScript errors from a stale `gigflow/` subfolder — fixed by adding it to `tsconfig.json` exclude list
- All source files were untracked and not deploying to Vercel — committed 32 missing files

### Decisions Made
- `reactStrictMode: false` in next.config.ts (required for @hello-pangea/dnd)
- KanbanBoard rendered client-side only via `dynamic(..., { ssr: false })`
- Dormant stage added to both the Supabase enum and TypeScript types
- Supabase migrations: `follow_up` interaction type, `dormant` venue stage

### What's Left Open
- Supabase migrations may still need to be run manually in the Supabase dashboard SQL editor:
  - `ALTER TYPE interaction_type ADD VALUE IF NOT EXISTS 'follow_up';`
  - `ALTER TYPE venue_stage ADD VALUE IF NOT EXISTS 'dormant';`
- GitHub push auth: osxkeychain is now working (last push succeeded without a token)
- No test suite configured yet

### Good Next Steps (pick up here)
- Invoice tracking — create and track invoices for booked gigs
- Calendar view — see booked gigs on a calendar
- Email composer — draft and send pitch emails directly from the venue detail page
- Venue notes improvements — richer interaction history

---

## Session 5 - 2026-04-07 - Invoices Page

### What Happened
- Built the `/invoices` page — lists all invoices with status badges (Draft, Sent, Paid, Void), amounts, venue names, event dates, and links to Stripe payment pages
- Added three summary cards at the top: Outstanding total, Collected total, Total invoice count
- Added "Invoices" to the sidebar nav
- Fixed the dashboard "Unpaid Invoices" stat card to link to `/invoices` instead of `/pipeline`

### Good Next Steps (pick up here)
- **Create Invoice form on venue detail page** — invoices can only be created via the API right now; need a UI to actually make one
- Calendar view — see booked gigs on a calendar
- Email composer — draft and send pitch emails from venue detail page

---

## Session 7 - 2026-04-22 - Outreach, Enrichment & Reply Tracking

### What Happened

**Outreach tracking on pipeline cards:**
- Email count badge on each card (e.g. "✉ 3× · 2d ago")
- Quick ✉ button on every card to send pitch email without opening venue detail

**Dashboard improvements:**
- Follow-up alert banner — red banner when venues haven't replied in 5+ days
- "Needs Attention" section upgraded to client component with per-venue "✉ Follow up" buttons and bulk "Send all follow-ups" button
- Pipeline conversion funnel — horizontal bars showing venue counts at each stage with conversion rate stats (contacted %, responded %, booked %)

**Gig prep checklist:**
- Each gig in the venue detail now has a 7-item prep checklist: load-in, sound check, payment, set list, equipment, parking, contact
- Tap the checklist badge to expand it; badge turns green with ✓ when all 7 are done
- Supabase migration 007 (gigs table) and checklist column added

**Contact email & address enrichment:**
- Auto-enriches venue email, phone, website, and address when adding from Discover
- "🔍 Find contacts" button in pipeline header to bulk-enrich all discovered venues
- "📍 Fill addresses" button in pipeline header to bulk-fill missing addresses
- Address lookup fixed — now uses Google Places API to find real street addresses (not road names)

**Email backfill:**
- Ran `scripts/enrich-venues.mjs` — found emails for 19 of 63 discovered venues, cleaned 10 fake/template emails, leaving 9 real usable addresses
- Ran `scripts/clean-emails.mjs` — cleared template emails (user@domain.com, wix sentry tracking, web designer emails)

**Pitch email batch send:**
- Sent full pitch emails to 9 newly-found venues: Furioso Vineyards, Cooper Mountain Ale Works, McMenamins Old Church & Pub, The Headliners Club, Two Dogs Taphouse, Domaine Willamette, Vanguard Brewing, Flaneur Wines, Press & Barrel Wine Collective
- All 9 moved to "contacted" stage with interactions logged

**Reply tracking:**
- "Got a reply? →" on Contacted cards now opens a modal to capture how they replied (email/call/in person) and what they said
- Saves a "reply" interaction type (new) before moving to Responded
- Venue timeline shows replies with a distinct green "↩ Reply" badge
- Reply option added to manual log form in venue detail
- Supabase migration 009 adds 'reply' to the interaction_type enum

### Decisions Made
- Enrichment runs automatically when adding venues via Discover (no separate button needed)
- Email scoring: booking/events/music addresses rank highest, then contact/info, then manager/owner
- Fake email detection: skip domains (wixpress, squarespace, lunabeanmedia, etc.) and skip prefixes (noreply, webmaster, etc.)

### Pick Up Here Next Session
- Gig prep checklist dashboard widget (upcoming gigs with checklist status at a glance)
- Any other items Taylor brings up

---

## Session 6 - 2026-04-07 - Calendar, Venue Tools, Dashboard

### What Happened

**iCloud Calendar integration:**
- Replaced Outlook with a universal ICS subscription feed (`/api/calendar/ics?uid=...`)
- Fixed middleware to allow unauthenticated access to ICS endpoint (calendar apps have no session)
- Fixed Supabase client in ICS route to use raw client instead of cookie-based SSR client
- Taylor's wife can subscribe to the same URL to see gigs on her calendar
- Vercel Deployment Protection was blocking the feed — Taylor disabled it in team settings

**Venue improvements:**
- Contact info (name, email, phone, website) now editable inline on venue detail page
- Gig Date, Start Time, End Time fields added to venue detail
- Venue Address field with "Look up ↗" button that searches OpenStreetMap by venue name/city
- Archive button (moves to Dormant, reversible) and Delete button (with confirmation) on venue detail
- "Add Venue" button on pipeline page — add a single venue without a CSV

**Pipeline:**
- "Got a reply? →" button renamed from "They replied ↩" to avoid confusion
- Pipeline stat cards link to filtered pipeline views

**Dashboard:**
- "This Week" section — shows booked gigs happening in the next 7 days with TODAY badge
- Revenue stat card — total collected from paid invoices
- Booked Gigs panel now shows gig date under each venue name, sorted by date

**Invoices:**
- `/invoices` page built and added to sidebar
- Dashboard "Unpaid Invoices" card links to `/invoices`

**Vercel/infra:**
- Downgraded from Pro trial to free Hobby plan — everything still works
- Working URL: `gigflow-git-main-taylor-anderson.vercel.app` (not `gigflow-drab.vercel.app`)

**Supabase migrations run this session:**
- `ALTER TABLE venues ADD COLUMN IF NOT EXISTS address TEXT;`
- `ALTER TABLE venues ADD COLUMN IF NOT EXISTS gig_time TEXT;`
- `ALTER TABLE venues ADD COLUMN IF NOT EXISTS gig_end_time TEXT;`

### Decisions Made
- Tabled multiple gig dates per venue — will build a proper `gigs` table in a future session
- Reverted iPhone-style scroll wheel time picker back to native time inputs (simpler, auto-advances on type)

### Pick Up Here Next Session
- **Multiple gig dates per venue** — build a `gigs` table so Taylor can schedule recurring monthly gigs at the same venue (e.g. Kopitos Cocina once a month). Each gig has its own date, start/end time, and can have its own invoice. The calendar and dashboard pull from all gigs across all venues.

---

## Session 2026-05-19 — Multi-User Sign-up, App Rename, Batch Email Design

### What Was Built

**Multi-user sign-up (fully shipped):**
- `/signup` page — invite-code gated, with inline code validation and "Create Account" flow
- `/onboarding` — 4-step wizard collecting artist name/phone, home region, social links, bio/photo
- Invite codes — 20 reusable beta codes (GIGFLOW-BETA-01 through GIGFLOW-BETA-20) in new `invite_codes` table
- Middleware guard — routes incomplete users back to /onboarding until profile is complete
- Auto-profile trigger — DB trigger auto-creates `profiles` row on new sign-up (no race condition)
- Login page — added "Don't have an account? Create one" link
- Shareable sign-up link format: `yourapp.com/signup?code=GIGFLOW-BETA-01` (code pre-fills + auto-validates)
- Data isolation confirmed — RLS on all tables, every user sees only their own venues

**App renamed: GigFlow → StageReach**
- All UI wordmarks, page titles, docs, and package.json updated
- Folder/directory names unchanged

**Vercel URL (from previous session):** `gigflow-git-main-taylor-anderson.vercel.app`

**Supabase migration to run (if not done yet):**
- `supabase/migrations/010_invite_codes.sql` — paste into Supabase SQL Editor and run

### Decisions Made
- Invite codes are reusable (no per-use tracking) — share the same code with multiple people
- New user profiles row created via SECURITY DEFINER DB trigger (not service role client)
- Wizard state held in React only — if user abandons mid-wizard, they restart from step 1
- Zones: upsert on (user_id, name) to avoid deleting existing venue data on re-submission

### Pick Up Here Next Session
**Batch pitch email feature — design partially complete, paused at email routing question:**

Agreed design so far:
- Button: "✉ Send pitch emails" in the Discovered column header on the pipeline page
- Modal mirrors existing `BulkFollowUpModal` pattern (3 phases: review → sending → done)
- Shows all discovered venues; grays out those without a contact email
- Sends via existing `/api/send-email` route, one by one with progress bar
- Auto-advances successfully sent venues from Discovered → Contacted

**Open question before implementation can start:**
How should emails be sent for non-Taylor users? Currently all emails go from `RESEND_FROM_EMAIL` (Taylor's personal address). Options discussed:
- **A (recommended):** Shared "Reply-To" approach — send from a StageReach domain address (e.g. `bookings@stagereach.com`), Reply-To set to the artist's real email so venues reply directly to them. Requires Taylor to own and set up a domain with Resend once.
- **B:** Each user connects their own email (OAuth) — too complex for beta.
- **C:** Per-user domain verification with Resend — too much setup for users.

Taylor needs to decide on Option A and whether they have/want a domain for StageReach before implementation begins.
