# GigFlow - Session Log

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
