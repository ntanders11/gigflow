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
                                                                                                                                                                    
  Pipeline stages (in order): discovered → contacted → responded → negotiating → booked (dormant is a side state, not part of the linear flow)
                                                                                                                                                                    
  Types are defined in types/index.ts.                      

  Key Flows

  Authentication — proxy.ts is the Next.js middleware. It uses the Supabase SSR client (cookie-based sessions) to protect all routes except /login, /signup, /profile/[id] (public artist profile), /api/calendar/ics, and /api/auth/validate-code.

  Multi-User Sign-up — /signup (public) validates an invite code then creates a Supabase auth user, with emailRedirectTo pointed at the production domain so confirmation links never land on localhost. A SECURITY DEFINER DB trigger (handle_new_user) auto-creates a profiles row on auth.users INSERT. New users are then routed to /onboarding to complete their profile.

  Onboarding Wizard — /onboarding is a 4-step client-side wizard collecting artist name/phone (step 1), home region (step 2), social links (step 3), and bio/photo (step 4). Photo upload is non-blocking — failures don't stop onboarding. On completion it upserts artist_profiles and inserts a zones row, then redirects to /dashboard. The middleware checks for artist_profiles.display_name and routes incomplete users back to /onboarding.                 
   
  Kanban Pipeline — app/pipeline/page.tsx fetches all venues for the current user and renders components/pipeline/KanbanBoard.tsx, which uses @hello-pangea/dnd for 
  drag-and-drop. Stage changes optimistically update local state, then PATCH /api/venues/[id] — rolling back on failure. Includes single-venue and batch pitch/follow-up email sending, with a select mode and floating send bar.
                                                                                                                                                                    
  Venue Detail — components/venue/VenueDetail.tsx handles stage changes, contact info editing, notes (saved on blur), logging interactions (POST                
  /api/interactions, which also updates last_contacted_at), invoice creation/deletion, and gig scheduling.
                                                                                                                                                                    
  Discover Venues — components/discover/DiscoverView.tsx auto-searches on load using the user's home zone. GET /api/venues/discover geocodes the city server-side (Google Geocoding API first, Nominatim with countrycodes=us as fallback) then queries Google Places Nearby Search for live-music venues. Venues already in the user's pipeline are silently excluded from results (no greyed-out duplicates).

  CSV Import — app/venues/import/page.tsx uploads a file to POST /api/venues/import, which parses it via lib/csv-parser.ts (no external library), validates fields, 
  and bulk-inserts using the Supabase service client (bypassing RLS). Expected CSV columns: Venue Name, Type, City, Zone, Confidence, Website, Live Music Details,
  Contact, Phone. Venues can also be exported back to CSV for sharing with another artist.

  Invoicing (Stripe) — InvoiceModal (components/invoice/InvoiceModal.tsx) creates a draft invoice via POST /api/invoices, then sends it via POST /api/invoices/[id]/send, which creates/reuses a Stripe customer, builds a real Stripe invoice + line item, finalizes it, and emails the venue a hosted "Pay Now" link. app/api/stripe/webhook/route.ts listens for invoice.paid and auto-marks the local invoice as paid. DELETE /api/invoices/[id] removes an invoice — if it was sent and not yet paid, it's also voided on Stripe's side first. The Invoices page (app/(protected)/invoices/page.tsx) lists all invoices across every venue and has its own "New Invoice" button with a venue picker (components/invoice/CreateInvoiceButton.tsx).

  Automated Follow-ups — app/api/venues/follow-up/route.ts, triggered by a Vercel cron job (protected by CRON_SECRET), automatically sends one follow-up email to any venue that's been in "contacted" for 5+ days with no reply.

  Outlook Calendar Connect — app/api/auth/outlook/connect and app/api/auth/callback/outlook implement an Azure AD OAuth flow so gigs can sync to a musician's Outlook calendar. app/api/calendar/ics exposes a public .ics feed as an alternative.

  Diagnostics — /api/email-status and /api/stripe-status (both require login) return a plain-language report of whether email sending and Stripe payouts are correctly configured. Useful for debugging delivery/payment issues without digging through provider dashboards.
                                                            
  Supabase Clients

  - lib/supabase/server.ts — server-side client (uses cookies, respects RLS)
  - lib/supabase/client.ts — browser-side client
  - Import routes use the service role key directly to bypass RLS for bulk writes
                                                                                                                                                                    
  Path Aliases
                                                                                                                                                                    
  @/* maps to the repo root — use @/components/..., @/lib/..., @/types/... for imports.

  Environment Variables

  Required in .env.local (and in Vercel's project settings for production):
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY                                                                                                                                   
  - SUPABASE_SERVICE_ROLE_KEY                               
  - RESEND_API_KEY / RESEND_FROM_EMAIL — email sending (pitch/follow-up/invoice emails). Fully wired up; the sending domain must be verified with Resend (SPF/DKIM) or mail lands in spam.
  - STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET — invoicing. The account's own bank/payout setup is managed entirely in the Stripe Dashboard, not in this codebase.
  - GOOGLE_PLACES_API_KEY — venue discovery (Places Nearby Search) and server-side geocoding
  - CRON_SECRET — authorizes the Vercel cron job that triggers automated follow-ups
  - AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID — Outlook calendar OAuth
  - NEXT_PUBLIC_APP_URL — base URL used for building absolute links (e.g. calendar/OAuth redirects)