# StageReach - Session Log

## Session: 2026-08-22 (continued) — Mobile profile layout fixed; dual-account-type bug found and fixed

**Public artist profile page fixed for mobile.** Taylor screenshotted her own profile on her phone — the sidebar/main layout (`app/profile/[id]/page.tsx`) was a fixed `flex` row with no responsive breakpoint, so the 3-column pricing grid got squeezed into a sliver of space with text cut off. Added `flex-col md:flex-row` and `grid-cols-1 sm:grid-cols-3` so both stack full-width below the `md`/`sm` breakpoints. Verified live at a real phone viewport size (375×812) before and after.

**Real, live account-corruption bug found and fixed.** Taylor reported logging out of her venue test account and back into her real artist account (`booking@taylorandersonmusic.com`), but kept landing on the venue profile instead. Checked the database directly — her real artist account genuinely had **both** an `artist_profiles` row and a stray `venue_profiles` row ("*Test Venue*"), plus one leftover self-addressed test booking request. Root cause: `POST /api/venue-profile` (called from `/venues/signup`'s mount effect) created a venue profile for whatever session happened to be active, with zero check on whether that session already belonged to an artist — so at some point Taylor must have landed on `/venues/signup` while still logged into her artist account (likely while testing), and it silently turned her real account into a dual artist+venue account. Since `proxy.ts` checks for a venue profile first, this permanently mis-routed every subsequent login. Fixed two ways: (1) deleted the stray `venue_profiles` row and its orphaned test booking request from Taylor's real account after confirming there was no other real data attached; (2) added a guard in `POST /api/venue-profile` that checks for an existing `artist_profiles` row and returns 403 instead of creating one, with a matching "You're signed in as an artist" screen on the signup page instead of silently falling through to a blank signup form. Verified the normal logged-out signup flow still renders correctly (no regression); could not live-test the new 403 path itself against a real artist session (no test credentials available in this environment), so this is verified by code inspection + `tsc` only, not an end-to-end click-through — worth Taylor confirming next time she's testing as an artist.

---

## Session: 2026-08-22 — Booking requests shipped; home-screen icon added; Outlook bug logged

**Booking requests merged and live.** All 12 tasks from `docs/superpowers/plans/2026-08-20-booking-requests.md` built via subagent-driven-development with two-stage review, including two real races found and fixed during review: a concurrent double-accept race on `PATCH /api/booking-requests/[id]` (fixed with conditional `.eq("status","pending")` updates plus orphaned-gig cleanup on the losing side), and a `router.refresh()`-doesn't-touch-client-state bug where the Sidebar's pending-request badge stayed stale after an accept/decline (fixed with the same custom-event pattern already used for the profile-photo badge). Final whole-implementation review clean. Merged `feature/booking-requests` into `main`, pushed.

**Home-screen icon added.** Taylor asked whether the app could show its real icon instead of a generic screenshot when saved to a phone's home screen. Found an existing, already-well-designed square icon asset (`public/stagereach-icon.svg`) and used the project's existing `sharp` dependency to rasterize it into `app/apple-icon.png`, `app/icon.png`, and `public/icons/icon-{192,512}.png`. Added `app/manifest.ts` (Next.js's auto-served web app manifest) and a `viewport`/`appleWebApp` block in `app/layout.tsx`. Caught and fixed a real bug during verification (not user-reported): `proxy.ts`'s auth middleware was redirecting `/manifest.webmanifest` to `/login` for logged-out visitors, since only static image extensions were excluded from the middleware matcher, not `.webmanifest` — confirmed via `curl` (307→/login before, 200+correct JSON after fix). Verified locally end-to-end; not yet reported to Taylor as complete/pushed as of this entry.

**Outlook OAuth bug logged, not yet fixed — needs Taylor to check Vercel.** Taylor hit `AADSTS90102: 'redirect_uri' value must be a valid absolute URI` trying to connect Outlook on the live site. Root cause traced to `process.env.NEXT_PUBLIC_APP_URL`, used to build the redirect URI in both `app/api/auth/outlook/connect/route.ts` and `app/api/auth/callback/outlook/route.ts` — almost certainly missing or wrong in Vercel's **production** Environment Variables (local `.env.local` correctly has `http://localhost:3000`, which is right for dev but would be wrong in prod). I have no Vercel access to check or fix this myself. **Next step:** Taylor needs to check Vercel → gigflow project → Settings → Environment Variables → confirm `NEXT_PUBLIC_APP_URL` is set to `https://stagereach.app` for the Production environment, then retry connecting Outlook.

**Home-screen icon artwork swapped twice at Taylor's request, now shipped.** Taylor sent her own vintage-mic icon art (via email attachment, since she was on mobile remote control and couldn't save a file locally — pulled it by having her email it to herself and reading the attachment via the Gmail MCP's raw-message/attachment decode). First version had a black margin baked into the image that showed as a black border once iOS applied its own corner mask — fixed by flood-filling the border with the icon's gold before regenerating all icon sizes. Taylor then sent a second, cleaner version with no border at all; swapped that in as the final artwork. All icon files (`app/apple-icon.png`, `app/icon.png`, `public/icons/icon-{192,512}.png`, `public/stagereach-icon-source.png`) now reflect Taylor's actual artwork, not the earlier placeholder. Pushed and confirmed live.

**Featured Reviews shipped (pending migration).** Taylor's next request after the icon work: let artists/venues pick up to 3 favorite received reviews to feature at the top of their public profile (a piece of the original mutual-ratings ask that got dropped during that feature's first build). Went through the full brainstorm → spec → plan → subagent-driven-development pipeline. Two real bugs caught along the way: (1) at spec-review stage, the featured-picks write algorithm needed to clear ALL of a caller's currently-ranked rows before writing new ranks, not just dropped ones, or reordering two already-featured picks would hit a unique-constraint collision; (2) at plan-review stage, `RatingView` was going to expose only a `featured: boolean` instead of the actual rank, which would have let the client's toggle logic silently scramble pick order using date-sorted fetch order instead of true rank order — fixed by exposing `featured_rank: number | null` and sorting by it client-side. A third issue (error-status conflation, and a partial-write state that didn't match the spec's own "ends up cleared" promise) was caught during Task 2's code-quality review and fixed there. Final whole-implementation review clean; merged `feature/featured-reviews` into `main`, pushed.

**Migration `020_featured_reviews.sql` not yet run — feature is live in code but inert until Taylor runs it.** Same situation as every other migration this session: I have no direct SQL access (no psql, no Postgres connection string, only the Supabase SQL Editor which is a manual dashboard action), and Taylor is on mobile remote control and can't run it right now either. Confirmed via a live query that the new columns (`featured_by_artist_rank`/`featured_by_venue_rank` on `venue_artist_ratings`) don't exist in the database yet. Verified this degrades gracefully in the meantime — the public profile page's ratings section just fails its fetch silently (expected 500 on the two public ratings routes, which now explicitly select the not-yet-existing columns) rather than breaking the rest of the page. **Update: migration run, feature fully live.** Taylor ran `020_featured_reviews.sql` via the Supabase SQL Editor from her phone shortly after this was logged — confirmed via a live REST query that `featured_by_artist_rank`/`featured_by_venue_rank` now exist on `venue_artist_ratings` with no error. Feature is live end-to-end; a real live test pass (Task 7 of the plan) still hasn't happened with actual rated relationships, since none exist with 4+ reviews to meaningfully test the load-more behavior yet.

---

## Session: 2026-08-18/19 (continued) — Mutual ratings shipped and live; live-testing fixes; Supabase auth-email branding started

### Mutual ratings: merged, deployed, migration confirmed live

Picked up right where the entry below left off: the pending 3-issue fix (wrong rating column, dead-end public venue page, missing reviewer links) was reviewed against the actual diff, confirmed correct, and re-reviewed by a subagent — approved clean. Ran final `npx tsc --noEmit` (clean) and `npx eslint` across the whole project — 22 errors total, but tracing every one confirmed all but 2 are pre-existing in files this feature never touched; the 2 attributable to this branch are `react-hooks/set-state-in-effect` warnings on the two new ratings pages, matching an already-accepted pattern used ~20 times elsewhere in this codebase (not a new problem class, no CI lint gate exists). Merged `feature/mutual-ratings` into `main` locally (commit `2b4be9e`), cleaned up the branch and worktree, pushed to `origin/main`. Taylor ran `supabase/migrations/018_venue_artist_ratings.sql` in the Supabase SQL Editor — confirmed live by querying both new tables directly via the REST API.

**All three pieces of StageReach's venue-facing portal are now shipped and live**: venue accounts & login, artist discovery for venues, and mutual ratings — the original request that kicked off this whole multi-session effort.

### Live-testing fixes found while Taylor tried to test it herself

- **No venue test account existed** — the last one ("Stickmen Brewing") was deleted during the 2026-08-18 cleanup and nothing new had signed up since.
- **Mobile: no way to sign out or reach a profile page at all.** The only sign-out button lived in the desktop sidebar (`hidden md:block`), invisible on phones — Taylor couldn't switch accounts to create a test venue from her phone. Fixed: added a "Profile" icon to the mobile bottom nav (`components/layout/Sidebar.tsx`'s `MobileBottomNav`) linking to `/artist-profile`, and added a "Sign out" button to the artist-profile page itself, which had never had one. Icon started as "☺" per my first pass, Taylor asked for something more professional — swapped to "◉" (plain filled-circle glyph, matches the flat geometric style of the other nav icons).
- **Old stray test artist account found and removed** — `ntayloranderson@icloud.com` turned out to already be a confirmed artist account (display name "Test", created 2026-08-13, unrelated to this feature) sitting unnoticed since an earlier session. Checked for real data first (found only one empty zone row, nothing else) then deleted via the Supabase admin API at Taylor's explicit request — same careful checked-then-deleted pattern as the 2026-08-18 venuetest cleanup.
- **Root cause of "signup skips straight past the email field" found and fixed**: the venue signup wizard (`app/venues/signup/page.tsx`) persists a pending-confirmation email in `sessionStorage` so a page refresh doesn't lose progress while waiting on the confirmation link — but there was no way OUT of that "Check your email" screen if the browser remembered a stale/already-used email (which is exactly what happened with the old icloud.com attempt). Fixed by adding a "Use a different email" link that clears the pending state and returns to a blank signup form.

### New task started, blocked on Chrome extension — Supabase auth-email branding

Taylor noticed account-confirmation emails come from Supabase's own generic sender, not `stagereach.app` — she wants them branded. This is a Supabase dashboard **Auth → Emails → SMTP Settings** change (custom SMTP pointed at Resend, since `stagereach.app` is already verified there), not a code change — nothing in the repo needs to change for this. Plan given to Taylor: Sender email `auth@stagereach.app` (or reuse `booking@stagereach.app`), Sender name `StageReach`, Host `smtp.resend.com`, Port `465`, Username `resend`, Password = the `RESEND_API_KEY` value. Flagged this as something to test immediately after saving, since it affects every account confirmation going forward — same risk class as the PKCE confirmation-route bug found in production on 2026-08-14.

Taylor asked me to do this directly via her real Chrome (using the Claude in Chrome extension) rather than walk through it herself — the Claude in Chrome extension is not currently connected in this environment, so this couldn't proceed. Gave her the install/sign-in link. She then asked to pause for tonight before retrying.

**Resume point:** either (a) Taylor has the Claude in Chrome extension connected next session and wants me to drive the actual SMTP setup in her real browser (I can fill every field except pasting the Resend API key into the password field myself — that's a hard rule for me, she'd need to paste that one field), or (b) she does it herself following the steps above. Either way, test with a real signup immediately after saving, before considering it done.

---

## Session: 2026-08-18 (continued) — Mutual ratings: all 17 tasks built, final review found 3 more issues, fix in progress (uncommitted)

Continued straight from the entry below (spec/plan were already finished; this picks up mid-implementation). Finished the remaining subagent-driven-development work:

**Tasks 8-17 all implemented and passed both review stages**, including the two flagged HIGH RISK tasks:
- Task 9 (gig-completion email trigger) — the two-Supabase-client requirement verified correct on both reviews.
- Task 11 (new public venue page) — verified via an actual `next build` (not just `tsc`) that there's no routing collision with the pre-existing private `/venues/[id]` page.
- Task 10 (middleware) — verified the scoped prefixes don't leak `/venues/import` or `/venues/[id]`.
- Task 13 caught and fixed a real gap mid-implementation: the plan put the artist pending-ratings page at a bare `app/ratings/page.tsx`, outside the `(protected)` route group that provides the Sidebar/nav chrome — moved to `app/(protected)/ratings/page.tsx`. (Task 14's venue-side page didn't have this problem — venue pages render their own nav directly, no route-group dependency.)

**Final whole-implementation review** (dispatched after Task 17) found one more real gap that had slipped through every individual task review: the spec's "Ratings you've given" list was supposed to show an Edit link and a Report link per rating, but the built pages left that list read-only — the backend for both fully worked, there was just no UI to trigger either. Fixed with a new `GivenRow` component on both `/ratings` and `/venue/ratings`, re-reviewed and approved. Committed as `81b243e`.

**A second final-review pass** (after the Edit/Report fix) found 3 more real issues, still uncommitted in the worktree as of pausing:
1. **Wrong column (bug, most important of the three):** `app/api/venues/discover/route.ts`'s `fetchVenueRatingsMap()` was averaging `venue_stars` (stars the venue gave OUT to artists) instead of `artist_stars` (stars the venue actually received) — so the Discover Venues rating badge would have shown a venue's own outgoing ratings as if they were its reputation. Caught by comparing against the public venue-ratings route, which correctly uses `artist_stars`.
2. **Dead end:** the new public venue page (`/venues/profile/[id]`) had zero inbound links anywhere in the app — reachable only by hand-typing a UUID.
3. **Spec deviation:** the spec requires each revealed review to link to the reviewer's own profile; `RatingsSection` rendered reviewer names as plain text with no id even available to link with.

A fix was dispatched covering all three (correct the column; add `reviewer_id` to `PublicRatingsResponse` and both public routes; add a `reviewerLinkPrefix` prop to `RatingsSection` so it can link each reviewer to `/profile/{id}` or `/venues/profile/{id}` depending on which page it's rendered on; wrap the existing "⭐ On StageReach" badge on Discover Venues cards in a link to the new public venue page, closing the dead-end). **The subagent finished the edits and `npx tsc --noEmit` is clean — but it was interrupted before running the commit step.** As of pausing, these changes sit uncommitted in the worktree at `/Users/tayloranderson/gigflow/.worktrees/mutual-ratings` (`git status --short` shows exactly 8 modified files: both public rating routes, `discover/route.ts`, both profile pages, `DiscoverView.tsx`, `RatingsSection.tsx`, `types/index.ts`).

**Update — fix reviewed against the diff manually and committed:** the pending diff was checked line-by-line against what was asked for (all three fixes present, nothing extra) and committed as `c6d9742`. A subagent review pass on that commit was dispatched but got interrupted mid-run before returning any findings — no findings were lost, none had come back yet.

**Resume point:** re-dispatch the spec-compliance + code-quality review for commit `c6d9742` (the three-issue fix) in the worktree, fix anything it finds, then do a final `npx tsc --noEmit` + `npx eslint` across the whole project, then `finishing-a-development-branch` (merge to main, likely option 1 given the pattern from both prior venue-portal features), then tell Taylor to run `supabase/migrations/018_venue_artist_ratings.sql` in the Supabase SQL Editor (required from the start, unlike the artist-discovery migration — nothing in this feature works until it's applied) and do a live end-to-end walkthrough (real completed+linked gig, both notification emails, both ratings submitted, reveal, public display on both profile pages, Discover badges on both sides, and now also the reviewer-profile links and the Discover Venues → public venue page link).

Two low-severity items from the final review were deliberately left as-is (not bugs, not worth fixing right now): two new `react-hooks/set-state-in-effect` ESLint warnings on the two ratings pages (matches ~20 pre-existing instances of the same warning elsewhere in this codebase — an accepted pattern here, not a new class of problem), and `CLAUDE.md`'s Authentication paragraph not yet mentioning the two new public route prefixes or the `venue_artist_rating_reports` table (worth a follow-up doc touch-up, not urgent).

---

## Session: 2026-08-18 — Mutual ratings: spec/plan finished, implementation in progress

### Spec and plan

Resumed the mutual-ratings brainstorm from 2026-08-14 (all 9 locked decisions from that session carried over unchanged — see that entry below for the full list: completed+linked-gig unlock, double-blind reveal, one rating per relationship ever, editable-anytime including post-reveal, new public venue page, dedicated pending-ratings list, simple report-to-Taylor moderation, shared-row/two-halves data model). Resolved the two items left open last time (route naming, Discover-card badges) plus one new one (email notifications) as part of finishing the design, then wrote the spec: `docs/superpowers/specs/2026-08-18-mutual-ratings-design.md`. Spec review went 3 rounds — real bugs caught and fixed: a route collision (`/venues/[id]` was already an existing *private* page — the new public venue page had to move to `/venues/profile/[id]`) that would have failed the build, and a middleware fix that would have accidentally exposed that same private page plus the existing private `/venues/import`.

Implementation plan written next: `docs/superpowers/plans/2026-08-18-mutual-ratings.md`, 17 tasks. Plan review went 2 rounds — caught 5 more issues (report email dropped spec-required content/link, two nav pending-count badges were silently cut instead of implemented, a risky show-then-fix code block for a memoryless subagent, an invented placeholder variable name, an ambiguous insertion anchor). All fixed and the plan was approved on the second pass.

### Implementation — in progress, paused mid-execution

Worktree `.worktrees/mutual-ratings`, branch `feature/mutual-ratings`, using subagent-driven-development (fresh implementer subagent per task, two-stage review: spec compliance then code quality).

**Done and fully reviewed (both stages passed) — Tasks 1-7:**
1. Migration (`018_venue_artist_ratings.sql`) — one code-quality fix applied (missing index on `artist_user_id`)
2. Types added to `types/index.ts`
3. `lib/ratings/eligibility.ts` (eligibility + qualifying-gig validation helpers)
4. `lib/email/rating-notifications.ts` — one code-quality fix applied (missing error logging on Supabase queries)
5. Artist-side rating routes (`app/api/ratings/`, `app/api/ratings/pending/`) — one code-quality fix applied (try/catch around `validateQualifyingGig`)
6. Venue-side rating routes (`app/api/venue/ratings/`, `app/api/venue/ratings/pending/`) — built the Task 5 fix in from the start, no fix loop needed
7. Report endpoint (`app/api/ratings/[id]/report/route.ts`) — approved clean, no fixes needed

**Implemented but NOT yet reviewed — Task 8:**
Public rating read routes (`app/api/public/venues/[id]/ratings/route.ts`, `app/api/public/artists/[id]/ratings/route.ts`) — committed as `c2416f1`, spec-compliance and code-quality review still need to be dispatched before moving on.

**Not started — Tasks 9-17:**
9. Gig completion trigger (modifies `app/api/gigs/[id]/route.ts`) — flagged HIGH RISK, needs the two-Supabase-client pattern done correctly
10. Middleware update (`proxy.ts`) — flagged HIGH RISK, scoped prefixes only, no blanket `/venues/`
11. Public venue profile page (`app/venues/profile/[id]/page.tsx` + `components/ratings/RatingsSection.tsx`) — flagged HIGH RISK, must NOT collide with the existing private `/venues/[id]` page
12. Artist profile ratings section (modifies `app/profile/[id]/page.tsx`)
13. Artist pending-ratings page + Sidebar badge
14. Venue pending-ratings page + VenueNav badge
15. Discover Artists rating badge
16. Discover Venues rating badge
17. Documentation updates (CLAUDE.md, CHANGELOG.md)

After Task 17, still needs: final whole-implementation review, then `finishing-a-development-branch` (merge/push), then ask Taylor to run the new migration in Supabase SQL Editor and do a live end-to-end walkthrough (mark a real completed+linked gig, confirm both notification emails, submit both ratings, confirm reveal, confirm public display + Discover badges).

**Resume point:** dispatch spec-compliance and code-quality review for Task 8 first (implemented, not yet reviewed), then continue task-by-task from Task 9 using the exact task text in the plan document — do not re-derive it, the plan already has complete, ready-to-paste code for every remaining task.

---

## Session: 2026-08-14 — Artist discovery ships; mutual ratings brainstorm started

### Wrapped up from the prior session

Merged `feature/artist-discovery-for-venues` to `main` (fast-forward, no conflicts), verified `npx tsc --noEmit` clean, deleted the merged branch, pushed to `origin/main` (`774e7c5`). Confirmed the new `zones.lat`/`lon`/`geocode_failed` migration (`017_zones_lat_lon.sql`) was applied and live by querying the table directly. Venue accounts & login and artist discovery for venues — the first two of three planned venue-portal pieces — are both fully shipped and live in production.

### Test data cleanup

Removed the 4 leftover test venue accounts from live-testing the venue-accounts feature (`ntayloranderson+venuetest`, `+venuetest4`, `+venuetest5`, `+venuetest6@gmail.com`). One of them ("Stickmen Brewing") had actually completed signup and was linked (via the linking sweep) to 2 real venue entries sitting in two different artists' actual pipelines. Rather than deleting those pipeline entries, unlinked them (`venue_profile_id` set back to null) so the real pipeline data is untouched and only the "⭐ On StageReach" badge disappears. Deleted the 4 auth accounts via Supabase's admin API; `profiles` rows cascade-deleted automatically. Verified nothing was left behind.

### Mutual ratings — brainstorm in progress, not yet speced or built

Taylor chose to build the mutual 1-5 star ratings system next (the third and final planned venue-portal piece, and the original feature request that kicked off the whole venue-portal effort), over the alternative option of booking/scheduling — booking remains explicitly deferred, still just "an idea for later."

**Decisions made so far, via one-at-a-time clarifying questions:**
- **Unlock condition:** a rating opportunity only exists once an artist has logged a gig, marked it "completed," **and** that pipeline venue is linked to a real StageReach venue account (i.e. verified real interaction on both sides) — not open to anyone, not based on unlinked/unverified gigs.
- **Content:** star rating (1-5) required, written review optional.
- **Reveal:** double-blind, Airbnb-style — neither side sees the other's rating until both have submitted.
- **Frequency:** one rating per venue-artist relationship, ever — not one per gig, even if they play together repeatedly.
- **Editing:** ratings are editable any time, **including after both sides have revealed to each other** — Taylor explicitly chose this despite the flagged tradeoff (it weakens the anti-retaliation protection double-blind is meant to provide, since someone could see the other side's rating and then edit theirs in response). This was a deliberate, informed choice, not an oversight — respect it going forward rather than re-litigating.
- **Visibility:** ratings need to be publicly visible to be useful, which means venues need a public profile page for the first time — `/venue/profile` today is private/management-only. Taylor approved building a new public venue page as part of this feature (artist-side already has one: `/profile/[id]`).
- **Entry point:** a dedicated "pending ratings" list page (not inline buttons scattered across existing pages) — works the same way for both artist and venue sides, and doubles as a history of ratings already given.
- **Moderation:** a simple "Report" button on any review, emails Taylor (reusing the existing Resend sending infra) so she can manually remove it via Supabase directly — no admin dashboard needed for v1.
- **Data model:** a single shared row per venue-artist relationship with two independent halves (`venue_stars`/`venue_review` and `artist_stars`/`artist_review`, each writable only by its own side) rather than two separate rating rows — chosen because it's simpler to query ("my pending ratings" = one table scan) and makes it structurally impossible for one side's rating to leak before both are in, no extra guard logic needed.

**Left open for next session:**
- Exact table schema/migration not yet written
- Public venue profile page route naming not yet decided (leaning `/venues/[id]` to mirror the artist-side `/profile/[id]` pattern, but not confirmed with Taylor)
- Whether average ratings should show as badges on Discover Venues / Discover Artists result cards (not yet asked)
- Full design doc not yet written — no spec review, no implementation plan yet. This was interrupted mid-brainstorm (Taylor signed off for the night right after confirming the data model approach) — next session should resume the brainstorming skill from here rather than starting over, since all the above decisions already have Taylor's explicit approval.

---

## Session: 2026-08-11 — Personal email sending via Gmail/Outlook OAuth

### The problem

Taylor asked whether there was a better way to send pitch/follow-up emails after noticing sends failing — investigation found a second real user ("Tiffany Bird") is on StageReach sharing the same Resend account as Taylor, and Resend's free tier caps sending at 100 emails/day across the whole account. With two active users already, that shared cap was going to keep causing problems as the app grows, not a one-off glitch.

### The decision

Presented two options: (1) upgrade Resend to a paid plan (~$20/month, removes the daily cap, simple) or (2) let each artist connect and send from their own Gmail/Outlook account via OAuth (more work, but removes the shared-cap problem entirely and makes outreach look like it's genuinely coming from the artist, not a shared bot address). **Taylor chose option 2.**

### Process followed

Used the project's brainstorming → spec → plan → subagent-driven-development workflow for a change this size:
- **Design questions resolved with Taylor:** support both Gmail and Outlook (not just one); fall back to the shared Resend sender automatically for anyone who hasn't connected anything (never block sending); the automated 5-day follow-up cron should also use a connected account when available, not just interactive sends; Outlook's connection should be combined with the *existing* (but never actually wired up) calendar-sync OAuth flow rather than a second separate login; the Connected Accounts UI lives on the Artist Profile page (there's no dedicated Settings page yet); if a connected account fails mid-send, retry via the shared sender automatically rather than surfacing an error.
- **Spec written, reviewed, and revised** (`docs/superpowers/specs/2026-08-11-personal-email-oauth-design.md`) — two review rounds caught real gaps before any code was written: refreshed OAuth tokens weren't being saved back to the database, a successful reconnect wasn't resetting the "needs reconnect" warning, and there was no plan for recording which service (Gmail/Outlook/shared) actually sent a given email.
- **13-task implementation plan written and reviewed** (`docs/superpowers/plans/2026-08-11-personal-email-oauth.md`) — plan review caught two more bugs before implementation: a transient network hiccup during token refresh would have wrongly told an artist to reconnect, and the "reconnect needed" UI state would have shown the wrong button.
- **Built task-by-task in an isolated worktree** (`.worktrees/personal-email-oauth`, branch `feature/personal-email-oauth`) using fresh subagents per task with two-stage review (spec compliance, then code quality) after each one.

### What got built

- New `email_connections` database table (one row per artist per provider — Gmail/Outlook — storing the connection and its OAuth tokens)
- New Gmail OAuth connect/send flow from scratch
- Outlook's existing calendar-only OAuth flow extended to also request mail-sending permission, and fixed — it turned out the redirect address had been hardcoded to `localhost` this whole time, meaning it had **never actually worked in production**, on top of never having a UI button to trigger it at all
- A shared `sendArtistEmail()` helper that all three sending paths (single pitch/follow-up, batch sends, the automated cron) now go through — tries the artist's connected account first, falls back to the shared Resend sender automatically on any failure
- A new "Connected Accounts" section on the Artist Profile page to connect/disconnect Gmail and Outlook

### Real issues caught and fixed during code review (not just style nitpicks)

- A hand-built email message (used for Gmail's API) had no protection against a malicious contact's name/address containing hidden characters that could forge extra hidden recipients into an outgoing email — fixed before it ever had a live caller
- The Gmail/Outlook "Connect" buttons had no protection against a login-linking attack where someone could trick an already-logged-in artist into connecting a Gmail account that isn't theirs — added standard OAuth security (a one-time verification token) to both providers
- The automated follow-up cron could have had one broken venue's send silently abort follow-ups for every other artist later in that day's batch — isolated so one failure can't take down the rest
- A missing Microsoft permission (`User.Read`) would have made every real Outlook connection attempt fail with a vague, unhelpful error — caught and fixed before Taylor ever hit it
- Documentation was double-checked against what was actually built and corrected twice — once for overstating that the feature was fully live before external setup is even done, once for citing an unverified number

### Where this stands

**Merged to `main` and live in production.** All 13 tasks complete, individually reviewed, final whole-implementation review passed. Both database migrations run in Supabase. Taylor created the Google OAuth client and granted Azure admin consent; both new env vars added to `.env.local` and Vercel. Pushed to `origin/main` and verified with real Gmail and Outlook sends showing the correct `sent_via` value. Follow-on work building on this (onboarding integration, diagnostics, disconnect UX) is logged in the entry below.

## Session: 2026-08-12 to 2026-08-13 — Onboarding email connect, diagnostics, sidebar fix, and disconnect warning

Four more features shipped on top of the personal-email-OAuth work above, each run through the same brainstorm → spec → plan → subagent-driven-development process, plus one small direct fix.

### 1. Connect email during onboarding

Taylor's ask: make sure new artists connect Gmail/Outlook as part of first-run setup — *"I just wanna make sure they get connected off the bat so that they can start working right away"* — rather than leaving it as something they might never discover on the Artist Profile page.

- Added a 5th onboarding step (Connect Gmail/Outlook) with no upfront "skip" — an artist either connects or explicitly chooses "Continue without connecting for now"
- Moved the profile/zone save earlier (from the old final "finish" button to the step 4 → 5 transition), since step 5 involves a full-page redirect to Google/Microsoft that would otherwise lose in-progress data
- A short-lived cookie tags the OAuth attempt as belonging to onboarding, so a failed connection during onboarding routes the artist back to the wizard instead of showing a generic error on the Artist Profile page
- Live-tested with a real signup end-to-end: profile, zone, and a real Outlook connection all saved correctly

### 2. Personal connection status in `/api/email-status`

Taylor's ask: *"Let's check the API status"* — extend the existing email diagnostics check to also show personal Gmail/Outlook connection health, not just the shared sender.

- Added `personal_gmail` / `personal_outlook` status lines and a `personal_email_active` summary line showing which account sending will actually use
- Fixed a real bug found during review: the helper that picks which connection to use returns the *newest* connection even if it needs reconnecting, so the status check needed an explicit "and is it actually active" condition — otherwise a broken connection would have been reported as fine

### 3. Sidebar photo not refreshing (direct fix)

Taylor noticed a newly-uploaded profile photo wasn't showing in the bottom-left sidebar until a full page reload. Fixed by having the profile save fire a lightweight signal that the sidebar listens for, so it re-fetches the name/photo immediately after a save — no reload needed.

### 4. Warning before disconnecting Outlook

Taylor's ask, picking from a list of previously-flagged small follow-ups: *"It's the connected accounts card"* — since Outlook's connection also powers calendar sync (both share one login), disconnecting it was silently turning off calendar sync with no warning.

- Added an inline confirm step (matching the app's existing invoice-delete confirm pattern) that warns *"This will also stop syncing your gigs to your Outlook calendar. Disconnect anyway?"* before disconnecting Outlook specifically. Gmail's disconnect is unchanged (it doesn't affect calendar sync).
- Taylor confirmed the confirm/cancel UI displays correctly live in the browser.

### Where this stands

All four features — onboarding email connect, email-status diagnostics, the sidebar fix, and the Outlook disconnect warning — are merged **and pushed to `origin/main`** — live in production. Taylor confirmed the disconnect warning's "Cancel" button reverts cleanly before the push.

### Pick Up Here Next Session

- Superseded — see the entry directly below. Venue accounts (the first of the three pieces described here) were designed and built in the very next session.

## Session: 2026-08-13 to 2026-08-14 — Venue accounts & login (first piece of the venue-facing portal)

Taylor's ask from the end of the prior session: build a venue-facing side of the app, plus a mutual 1–5 star rating system between artists and venues. This was too large for one spec, so it got broken into three sequenced pieces — **venue accounts & login** (this entry), then artist discovery for venues, then booking — decided together with Taylor before any design work started.

### Design decisions made with Taylor

- Venues should be able to **find and claim** a venue that's already sitting in some artist's private pipeline, rather than always starting from scratch — this became the "search → claim or create fresh" signup flow.
- Venue signup is **open, no invite code** — Taylor's growth plan is artist-first ("get artists to use it and then start to have venues use it once artists are already using it"), so there's no reason to gate venue signup the way artist signup is gated.
- **No ownership verification** beyond first-claim-wins, blocked from claiming the same venue twice — Taylor explicitly said he's "not really concerned with that" at this stage.
- Once a venue signs up, it should be **visibly connected back to wherever it already exists** — both the specific pipeline entry a venue claimed, and any *other* artist's separate copy of that same venue. This became a "linking sweep" that runs across every artist's pipeline, not just the entry the venue interacted with.
- Real venue accounts should be **prioritized and badged** in the existing Discover Venues search — Taylor: "I want the real stage reach account of venues to have a higher ranked and badged profile when it's searched." This also applies to the badge shown on pipeline cards for venues an artist already has.
- The badge went through several rounds — a gold shield (drawn live via the visual-companion browser tool, iterated on shape three times), then a gold microphone, then pulling from the actual StageReach logo's ring-and-mic motif — before Taylor settled on a plain gold star: "I hate all of these. Let's just do a gold star and call it a day."
- Pricing/monetization for venues (subscription vs. ad space) was explicitly deferred — Taylor hadn't decided, and nothing in this piece needed that decision to be built.

### Process

Full brainstorm → spec → plan → subagent-driven-development cycle, same as every other feature this session, but at roughly triple the scale of anything built before it:
- Spec (`docs/superpowers/specs/2026-08-13-venue-accounts-design.md`) went through **three review rounds**, catching a real middleware bug (venue accounts would have been misrouted into the artist onboarding wizard), a claim race condition, a factual error about Discover Venues having a confidence-based sort it doesn't actually have, a missing service-role/RLS callout, and a missing DB-level duplicate-prevention constraint.
- 16-task implementation plan, each task built by a fresh subagent and passed through two-stage review (spec compliance, then code quality) — real bugs caught and fixed at nearly every step: a case-insensitive matching bug in the cross-pipeline linking sweep, a missing `ORDER BY` before a `LIMIT` that could silently drop a venue's own match, no try/catch anywhere in the two new client-side forms (leaving the UI stuck on any network hiccup), a serialized database call that could have added latency to the *existing*, already-shipped Discover Venues search.
- One implementer subagent hit a monthly usage limit mid-fix, leaving a half-applied change in the working tree; sorted through by hand (kept the good parts, fixed a bug the interrupted attempt introduced, removed a misleading access check it added that wasn't asked for and didn't actually work).
- A final whole-implementation review (after all 16 tasks individually passed) caught one more real bug that no single task's review could have: a venue logging back in for the *second* time landed on the artist dashboard instead of their own profile — only the signup wizard's own one-time redirect worked, nothing routed a returning venue anywhere on subsequent logins. Fixed directly in `proxy.ts`.

### What got built

- New `venue_profiles` table, separate from artists' private `venues` pipeline rows, plus a `venues.venue_profile_id` link column
- `/venues` public landing page and `/venues/signup`, a 4-step wizard (create account → search existing pipeline entries → claim or start fresh → fill in profile details)
- Cross-artist search and a "linking sweep" — both via the service-role client (same pattern the CSV import route already used), scoped tightly to public-safe fields only (name, city, address, type — never notes, contact info, pipeline stage, or which artist owns the relationship)
- `proxy.ts` now recognizes venue accounts and routes them correctly, never into the artist onboarding wizard
- `/venue/profile` — the venue's own protected area (the entire venue-facing app surface for now)
- A "⭐ On StageReach" gold star badge on pipeline cards, the venue detail page, and Discover Venues search results — where a real account is always ranked first (Discover Venues had no sort of its own before this)

### Where this stands

**Merged to `main` locally.** Not yet pushed. **The new migration (`supabase/migrations/016_venue_profiles.sql`) has not been run in Supabase yet — and unlike every prior feature, this one can't wait until convenient.** Two already-shipped, unrelated pieces of the app (adding a venue manually, and adding one from Discover Venues) now depend on the new database column. Pushing this before the migration runs would break those for every artist, not just leave the new feature inert.

One known, deliberately-accepted limitation: the two new search/claim endpoints only check "is someone logged in," not "is this caller specifically a venue" — an artist could technically call them directly. Data exposure is narrow (venue name/city/address/type only), and this matches Taylor's explicit "not concerned with that" stance on verification — flagged for awareness, not treated as a blocker.

### Pick Up Here Next Session

1. **Run the migration in Supabase's SQL Editor before anything else** — then push to `origin/main` and live-test the full signup/claim/badge flow with Taylor in the browser, same as every other feature.
2. Once venue accounts are confirmed live: the next piece is **artist discovery for venues** (a venue-side search for artists), followed by **booking**, and only after both of those, the **mutual 1–5 star rating/review system** (with highlighting) Taylor originally asked for — venue accounts had to come first since ratings need venues to have real identities.

## Session: 2026-05-28 (2) — Beta Tester Bug Fixes

### What Was Fixed

**Names showing as "Taylor Anderson" for all users:**
- Removed hardcoded fallback name/phone/website from `lib/email-templates.ts` — all fields now empty string if no profile
- Removed "TA" initials and "Newberg, OR" from `app/(protected)/artist-profile/page.tsx`
- Same fix on the public profile page `app/profile/[id]/page.tsx`
- Removed local `buildFollowUpEmail` function in `BulkFollowUpModal.tsx` that had Taylor's info baked in — replaced with shared template functions

**Venue discovery returning zero results:**
- Root cause: Overpass API (OpenStreetMap) only surfaces venues tagged `live_music=yes`, which is almost nothing in US cities
- Switched `app/api/venues/discover/route.ts` to Google Places Nearby Search API (key was already configured, just unused here)
- Two passes: live music venues first, then bars/breweries; both with 8-second AbortSignal timeouts
- Kept Overpass as fallback
- Added `/api/zones` route to expose the user's home region
- Discover page now fetches the user's zone and pre-fills the city field

**Photo uploads failing:**
- Cropped canvas was generating full-resolution output (4000px+) → files exceeding Vercel's 4.5MB limit
- Added 800px cap in `PhotoCropModal.tsx`
- Fixed content-type mismatch: canvas always outputs JPEG but file was labeled as original type
- Onboarding was using the browser Supabase client directly (subject to RLS) — switched to `/api/upload-photo` which uses the service role key

**Onboarding "Skip for now" infinite redirect:**
- `artist_profiles` INSERT was failing silently because required columns (`genres`, `video_samples`, `packages`) weren't included
- `zones` upsert was using `onConflict: "user_id,name"` which requires a UNIQUE constraint that doesn't exist in the DB
- Fixed both: PATCH route now does update-then-insert with safe defaults; zones uses check-then-insert-or-update
- The middleware checks `display_name`; until it was saved, the redirect loop was permanent

**Onboarding "Saving…" frozen:**
- No try/catch around the async `finish()` logic — any exception left `saving=true` forever
- Added try/catch with `setSaving(false)` in the catch handler
- Added `AbortSignal.timeout()` on all fetch calls so genuine network hangs surface as errors

**Photo upload still failing (latest fix):**
- Made photo upload non-blocking — if it fails for any reason, onboarding continues with a warning
- Added actual error message to the generic catch fallback for better diagnosis
- Added env var guard in `/api/upload-photo` to log clearly if `SUPABASE_SERVICE_ROLE_KEY` is missing

### Key Technical Decisions
- Google Places used over Overpass for US venue discovery (much better coverage)
- Photo upload failure is non-fatal in onboarding — users can always add photo from profile settings later
- Update-then-insert pattern used instead of upsert (avoids UNIQUE constraint dependency in the DB)

### Left Open
- Confirm beta testers can now complete onboarding end-to-end
- If photo upload is still failing in production, check Vercel env vars for `SUPABASE_SERVICE_ROLE_KEY` and verify the `artist-photos` bucket exists in Supabase with public access enabled

---

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

## 2026-07-07 (continued) — Email deliverability fix, in progress

**Goal:** Fix pitch/follow-up emails landing in spam. Root cause confirmed via `/api/email-status`: `stagereach.app` is not verified with Resend (SPF/DKIM missing).

**Key discovery this session:** The domain has been stuck "Pending" in Resend for about a month. Investigated why — GoDaddy's own DNS Management page states *"Your domain is registered at GoDaddy, but its DNS is currently managed elsewhere"* → **DNS Provider: Vercel**. This means any DNS records added in GoDaddy would never take effect, because GoDaddy is not authoritative for this domain's DNS — Vercel is (this happens automatically when a custom domain is connected to a Vercel project). This is almost certainly why verification never completed.

**Corrected plan:** Add the 5 Resend-required DNS records in **Vercel's domain DNS records page** instead of GoDaddy.

Records needed (exact values are in Resend → Domains → stagereach.app → DNS Records; use the copy button on each value field, don't retype — they're truncated on screen):
| Type | Name/Host | Value | Priority |
|------|-----------|-------|----------|
| TXT | `resend._domainkey` | (DKIM value, starts `p=MIGfMA0GCSqG...`) | — |
| MX | `send` | (starts `feedback-smtp...amazonses.com`) | 10 |
| TXT | `send` | (starts `v=spf1 include:...`) | — |
| TXT | `_dmarc` | `v=DMARC1; p=none;` (optional but recommended) | — |
| MX | `@` | (starts `inbound-smtp...amazonaws.com`) | 10 |

**Where we left off:** Navigated Vercel dashboard → Project → Settings → Domains → clicked "Edit" on `stagereach.app` → found a link "View DNS Records & More for stagereach.app →". Taylor was about to click that link to reach the actual DNS records editor when we paused.

### Pick Up Here Next Session
1. Click "View DNS Records & More for stagereach.app" in Vercel (Project → Settings → Domains → Edit on stagereach.app)
2. Add the 5 records from the table above (copy exact values from Resend, don't retype)
3. Back in Resend → Domains → stagereach.app, click the check/verify icon to trigger re-verification
4. Wait for propagation (minutes to hours), then confirm via `/api/email-status` that `stagereach.app` shows as verified
5. Once verified, have someone send a real test pitch email and confirm it lands in the inbox, not spam

Also still open from earlier: confirm whether `013_add_stagereach_codes.sql` invite-code migration was ever run in Supabase SQL Editor.

## 2026-07-14 — Website rebuild (new project: ~/taylor-music-site)
Taylor asked to replace the Squarespace site (taylorandersonmusic.com) to stop paying for it. Decided: rebuild as a free Vercel-hosted Next.js site; design refresh keeping current pages/content; bio influences updated to Beach Boys, Prince, Amy Winehouse; new booking-inquiry form on Private Events (Resend). Built and verified the whole site locally; code pushed to github.com/ntanders11/taylor-music-site.
Key discoveries: (1) Taylor's email is Microsoft 365 via GoDaddy, NOT Squarespace — cancelling Squarespace is safe for email; DNS cutover must never touch MX/TXT. (2) The Resend account has NO verified domain — this is the root cause of GigFlow's unresolved email-deliverability issue. Plan: verify taylorandersonmusic.com in Resend during the DNS cutover, then fix GigFlow's RESEND_FROM_EMAIL too.
Open: Taylor imports the repo in Vercel, reviews the preview URL, then DNS cutover + Squarespace cancellation.

## 2026-07-15 — Email deliverability fix, resolved

**Resolved:** The spam issue tracked since 2026-07-07 (and root-caused during the 2026-07-14 website session) is fixed.

What happened: Taylor's original Resend account was shared/broken, and `stagereach.app` had never been properly DNS-verified there — this was the root cause of both the website's booking form failing and GigFlow's emails landing in spam. While rebuilding the personal website, Taylor moved Resend to a new dedicated account under `booking@taylorandersonmusic.com` and fixed the website's email there. That work also (accidentally) deleted the old `stagereach.app` domain entry from Resend.

This session: re-added `stagereach.app` to the new Resend account, walked through adding all 5 DNS records (DKIM TXT, SPF MX, SPF TXT, DMARC TXT, receiving MX) into **Vercel's DNS records page** (not GoDaddy — GoDaddy is only the registrar; Vercel manages this domain's actual DNS since it's connected to the Vercel project). Domain now shows fully **Verified** in Resend (all sub-records green).

Also generated a new Resend API key and updated it in both `.env.local` (local dev) and Vercel's production Environment Variables (`RESEND_API_KEY` for the `gigflow` project) — the old key was still pointed at the broken/old account. Vercel auto-redeployed after the env var change.

**Confirmed resolved same session:** Sent two real test pitch emails via the live app — both landed straight in the inbox (not spam), confirmed by searching Mail directly. The deliverability fix works end-to-end.

**Confirmed resolved (no action needed):** Queried the `invite_codes` table directly via the Supabase REST API using the service role key — all 5 codes from `013_add_stagereach_codes.sql` (`STAGEREACH2026`, `STAGEREACH`, `BETA`, `MUSICIAN`, `GIGFLOW`) were already present and active, added back on 2026-05-28/29. The migration had already been run; this was just an unconfirmed item on the list, not an actual bug. The shareable signup link (`stagereach.app/signup?code=STAGEREACH2026`) has been working the whole time.
