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
  - Interaction — logged contact event (email, call, in-person, note) tied to a venue
                                                                                                                                                                    
  Pipeline stages (in order): discovered → contacted → responded → negotiating → booked
                                                                                                                                                                    
  Types are defined in types/index.ts.                      

  Key Flows

  Authentication — proxy.ts is the Next.js middleware. It uses the Supabase SSR client (cookie-based sessions) to protect all routes except /login.                 
   
  Kanban Pipeline — app/pipeline/page.tsx fetches all venues for the current user and renders components/pipeline/KanbanBoard.tsx, which uses @hello-pangea/dnd for 
  drag-and-drop. Stage changes optimistically update local state, then PATCH /api/venues/[id] — rolling back on failure.
                                                                                                                                                                    
  Venue Detail — components/venue/VenueDetail.tsx handles stage changes, contact info editing, notes (saved on blur), and logging interactions (POST                
  /api/interactions), which also updates last_contacted_at on the venue.
                                                                                                                                                                    
  CSV Import — app/venues/import/page.tsx uploads a file to POST /api/venues/import, which parses it via lib/csv-parser.ts (no external library), validates fields, 
  and bulk-inserts using the Supabase service client (bypassing RLS). Expected CSV columns: Venue Name, Type, City, Zone, Confidence, Website, Live Music Details,
  Contact, Phone.                                                                                                                                                   
                                                            
  Supabase Clients

  - lib/supabase/server.ts — server-side client (uses cookies, respects RLS)
  - lib/supabase/client.ts — browser-side client
  - Import routes use the service role key directly to bypass RLS for bulk writes
                                                                                                                                                                    
  Path Aliases
                                                                                                                                                                    
  @/* maps to the repo root — use @/components/..., @/lib/..., @/types/... for imports.

  Environment Variables

  Required in .env.local:                                                                                                                                           
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY                                                                                                                                   
  - SUPABASE_SERVICE_ROLE_KEY                               
  - RESEND_API_KEY / RESEND_FROM_EMAIL (email sending — not yet wired up)