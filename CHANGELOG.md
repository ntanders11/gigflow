# StageReach Changelog

## 2026-08-13
- [Feature] The email diagnostics page (/api/email-status) now also shows whether you've connected a personal Gmail or Outlook account, whether it's healthy, and which one your pitch/follow-up emails are actually sending from right now — alongside the existing shared-sender checks.

## 2026-08-12
- [Feature] New artists now connect their Gmail or Outlook account as part of signing up (a new 5th onboarding step), instead of only discovering the option later on their profile page. If a connection attempt fails, artists can still continue and connect later — nothing about signup is ever fully blocked.

## 2026-08-11
- [Feature] Artists can now connect their own Gmail or Outlook account (Artist Profile → Connected Accounts) so pitch and follow-up emails send from their real address instead of the shared StageReach sender — removes the shared sender's daily sending limit as a growth bottleneck for anyone who connects. If nothing is connected, or a connected account has a problem, sending automatically falls back to the shared sender so outreach never stops.
- [Fix] The Outlook calendar-connect flow had never actually worked in production — the redirect address was hardcoded to a local development URL. Fixed as part of rebuilding this flow to also handle email sending.
- [Note] Requires a one-time setup step (creating Google OAuth credentials, granting a Microsoft permission) before artists can actually connect an account — not yet done as of this entry.

## 2026-07-28 (merging search results)
- [Fix] Some searches were returning very few venues (e.g. only 2 near Vancouver, WA) even though many more real bars/breweries existed nearby. Cause: Google's precise filtering only matches a couple of places per area, and Geoapify was only being used when Google returned zero results, not to fill in the gaps. Now both are searched at the same time and combined — verified this takes a sparse 2-result search up to around 50.

## 2026-07-28 (restoring Google Places as primary, 1 not 2)
- [Change] Restored Google Places as the primary venue search provider (with Geoapify and OpenStreetMap Overpass as automatic backups), after all — decided the better data quality was worth keeping now that billing, the daily spending cap, and the primaryType noise fix are all in place and verified working.

## 2026-07-28 (restoring Google Places, then reverting it)
- [Change] Reverted venue discovery back to Geoapify as the sole provider. Google Places was fully working (billing active, spending capped at 200 requests/day on both APIs) and a real precision bug was fixed (results like Topgolf and a bowling alley were sneaking in because Google tags places with many overlapping categories — fixed by filtering on Google's more specific "primaryType" field instead). But after seeing it working, decided the ongoing complexity and even-capped financial exposure wasn't worth it for the quality gain — Geoapify's data already avoids the same noise problem (OpenStreetMap tags each place with one specific category, not a long overlapping list) at zero cost and zero billing risk. The Google integration is fully preserved in git history if ever wanted back.
- [Fix] Added the "Powered by Geoapify" + OpenStreetMap attribution required by Geoapify's free-tier terms, now that it's the sole search provider rather than an occasional fallback.

## 2026-07-28 (continued)
- [Change] Switched venue discovery back to Google Places as the primary search, now that billing is active on the Google Cloud project. Combined what used to be 2 search calls per user search into 1, halving the billable calls and doubling the free monthly search volume before any cost kicks in. Geoapify and OpenStreetMap remain as automatic backups if Google is ever unavailable.
- [Feature] A hard daily request cap (200/day) was set on both the Places and Geocoding APIs in Google Cloud, so runaway or abusive traffic can never generate a surprise bill — worst case is capped around $32/month, and normal usage is expected to stay free.
- [Feature] Venues Google explicitly tags as live music venues now show a "🎵 Live music confirmed" badge on the Discover Venues page — the first genuinely confirmed (not just guessed) live-music signal in the app.

## 2026-07-28
- [Fix] Discover Venues search was completely broken ("Search unavailable — please try again.") for every location. Root cause: the Google Cloud project behind venue search and geocoding had its free trial expire, blocking both APIs — fixing it would have required adding a payment method. Switched venue discovery to Geoapify (a free service, no billing needed) for both geocoding and venue search; the free OpenStreetMap fallback stays in place as a last resort. Verified with real searches — dozens of bars, breweries, and wineries now return correctly.
- [Feature] Select and bulk-add venues on the Discover Venues page — each result now has a checkbox, plus a Select All toggle. The "+ Add" button adapts: "Add All Venues" when nothing's checked, "Add Selected Venues" once you've picked some, with a live progress count while adding.
- [Change] Discover Venues page no longer claims results are confirmed "live music venues" — checked the underlying map data directly and found it almost never has that level of detail. Copy now accurately describes results as bars/pubs/breweries/wineries/nightlife venues worth pitching, not a pre-verified list.
- [Fix] Discover Venues search was pulling in irrelevant results (art museums, a bowling alley, a climbing gym, a movie theater) because of an overly broad search category. Removed that category — search now stays scoped to small, informal venues (bars, pubs, clubs, breweries, wineries), the kind you can walk into and pitch directly, rather than places like university auditoriums or city park amphitheaters that book through a different channel entirely.

## 2026-07-15
- [Fix] Pitch/follow-up/invoice emails landing in spam — finally resolved. Root cause: the old Resend account's shared setup broke, and the domain was never properly verified. Moved to a new dedicated Resend account (booking@taylorandersonmusic.com), re-verified stagereach.app there (DKIM, SPF, DMARC, and receiving MX all confirmed "Verified"), generated a new API key, and updated it in both local dev and Vercel production. Next real pitch/follow-up email sent should land in the inbox, not spam.

## 2026-07-07
- [Feature] Full StageReach brand look applied everywhere — new color palette (Midnight Black, Warm Ivory, Vintage Gold, Electric Violet) and the new microphone logo, both in the sidebar and on the login page
- [Feature] "New Invoice" button on the Invoices page — previously invoices could only be started from a venue's own page; now you can search for a venue and start one directly from Invoices
- [Feature] Delete an invoice — a Delete link (with a confirm step) is now available on both the Invoices page and a venue's own invoice list. If it was already sent and unpaid, it's also voided on Stripe's side so the venue can't pay a link you've removed
- [Fix] Several mobile layout problems: Discover results were squeezed into unreadable columns, the Pipeline page's "+ Add" button was cut off the edge of the screen, Venue Detail's contact fields were cramped into two columns, and invoice rows overflowed off-screen — all now resized properly for phones
- [Tool] Added /api/email-status and /api/stripe-status, diagnostic pages (visit while logged in) that report in plain language whether email sending and Stripe payouts are correctly configured
- [Data] Confirmed via /api/stripe-status that the live Stripe account (Chase bank account connected, payouts enabled) is fully ready to accept and receive real invoice payments
- [Open issue] Pitch/follow-up emails are still landing in spam — /api/email-status confirms stagereach.app is not yet verified with Resend (SPF/DKIM records need to be added in GoDaddy). Not resolved yet.

## 2026-05-28 (beta tester bug fixes — session 2)
- [Fix] Beta testers no longer see "Taylor Anderson" as their name — all hardcoded fallback names removed from email templates, profile page, public profile, and sidebar
- [Fix] Venue discovery now uses Google Places Nearby Search (2-pass: music venues, then bars/breweries) — previously only used OpenStreetMap which returns near-zero results in US cities
- [Fix] Discover page now auto-fills the search city from the user's own home region instead of defaulting to empty
- [Fix] Photo uploads no longer fail silently — added canvas size cap (800px) to keep files under Vercel's 4.5MB limit, and fixed JPEG content-type mismatch
- [Fix] Onboarding "Skip for now" button now works — was caught in an infinite redirect loop because the profile save was silently failing; fixed the update-then-insert logic and added proper error defaults
- [Fix] Onboarding "Saving…" button no longer freezes permanently — added try/catch so errors surface to the user, and AbortSignal timeouts on all API calls
- [Fix] Photo upload during onboarding is now non-blocking — if the photo fails for any reason, onboarding continues and the user can add a photo from their profile page later
- [Fix] Upload route now logs a clear error if the Supabase service role key is missing from environment variables

## 2026-05-28
- [Feature] Batch Pitch Email — "Send Batch Pitch" button on the Discovered column lets you select multiple venues, preview the email, and send to all of them at once; successfully sent venues automatically advance to Contacted
- [Feature] Batch Follow-up Email — "Send Follow-up" button on the Contacted column works the same way; venues already followed up are greyed out and skipped
- [Feature] Select mode with checkboxes, Select All / Deselect All, and a floating send bar on the Pipeline page
- [Feature] Custom domain live: app now runs at stagereach.app (Vercel + GoDaddy DNS)
- [Feature] Beta invite link: stagereach.app/signup?code=STAGEREACH2026 — code pre-fills and auto-validates
- [Fix] Pitch email body no longer arrives empty if the artist profile loads slowly — template text is shown immediately on modal open
- [Fix] Follow-up emails now log with type "follow_up" so the system correctly identifies venues that have already been followed up
- [Change] All in-app branding updated from GigFlow to StageReach
- [Change] Emails now send from booking@stagereach.app with Reply-To set to the artist's real booking email

## 2026-05-14
- [Feature] Multi-user sign-up: other musicians can now create GigFlow accounts using an invite code at /signup
- [Feature] 4-step onboarding wizard at /onboarding collects artist name, location, social links, and profile photo
- [Feature] Middleware now routes new users to onboarding until their profile is complete
- [Feature] 20 reusable beta invite codes (GIGFLOW-BETA-01 through GIGFLOW-BETA-20) — run migration 010_invite_codes.sql in the Supabase SQL Editor to activate them

## 2026-05-12
- [Data] Verified and patched contact names + emails from NW Venues spreadsheet onto all 37 recently imported venues
- [Feature] Email guesser script — for venues missing an email but with a known website, auto-generates pattern emails (info@domain.com, booking@domain.com, etc.) and verifies the domain resolves before saving; filled 21 venues
- [Feature] Phone number filler script — uses Google Places to look up phone numbers for venues missing an email; added 13 phone numbers
- [Feature] Address filler script — bulk-filled 129 missing venue addresses via Google Places; last 2 (Amity Vineyards, Chehalem Valley Brewing) found via DuckDuckGo scraping
- [Fix] Removed bad Facebook email (info@facebook.com) mistakenly stored for Lay Low Lounge
- [Data] Sent second follow-up email to all 33 contacted venues — shorter "last check-in" tone with updated subject line
- [Data] Sent initial pitch emails to 81 discovered venues

## 2026-04-22
- [Feature] Reply tracking — "Got a reply?" on pipeline cards now opens a popup to log how the venue replied (email, phone call, or in person) and what they said, before moving them to Responded
  - Reply is saved as a real interaction so you have a record of every conversation
  - Venue timeline shows replies with a green "↩ Reply" badge — easy to tell apart from emails you sent
  - Reply option also available in the manual log form inside every venue detail page
- [Feature] Contact email finder — auto-scrapes venue websites for booking/contact emails when adding venues from Discover
- [Feature] Bulk enrichment — ran backfill to find emails and addresses for all existing discovered venues
- [Data] Sent initial pitch emails to 9 newly-found venues: Furioso Vineyards, Cooper Mountain Ale Works, McMenamins Old Church & Pub, The Headliners Club, Two Dogs Taphouse, Domaine Willamette, Vanguard Brewing, Flaneur Wines, Press & Barrel Wine Collective
- [Feature] Dashboard follow-up alerts — banner and list of venues that haven't replied in 5+ days, with one-click follow-up sending
- [Feature] Pipeline conversion funnel — visual bar chart on dashboard showing how many venues are at each stage and conversion rates
- [Feature] Gig prep checklist — each gig has a 7-item checklist (load-in, sound check, payment, set list, equipment, parking, contact); badge turns green when all done
- [Fix] Venue address lookup now correctly finds street addresses instead of road names

## 2026-04-02
- [Feature] Automated follow-up emails — any venue in "contacted" stage for 5+ days with no reply gets a follow-up automatically every morning at 8 AM Pacific
  - Each venue only ever receives one follow-up (never spammed)
  - Follow-ups are logged as interactions so you can see them in the venue timeline
  - Powered by a Vercel cron job; no manual action needed

## 2026-04-01 (continued)
- [Data] Scraped contact emails for 26 venues from their websites — emails are now saved to venue records and ready for pitch outreach
- [Data] Restored all no-website venues after accidental deletion; Trellis noted as recorded-music-only in its notes field

## 2026-04-01
- [Feature] Stripe invoicing — create and send invoices to venues directly from GigFlow
  - New "Create Invoice" button on every venue detail page
  - Supports full payment or deposit (percentage-based)
  - Sends a real Stripe invoice to the venue's contact email with a hosted payment link
  - Invoice status (Draft / Sent / Paid) shown on venue page and dashboard
  - Dashboard now shows "Unpaid Invoices" count and total outstanding amount
  - Stripe webhook auto-marks invoices as paid when venues pay online
  - Manual "Mark Paid" option for cash/check payments

## 2026-07-14
- [Change] Started the taylorandersonmusic.com website rebuild in its own project (taylor-music-site) — built, tested, and pushed to GitHub; awaiting Vercel setup and domain switch.
- [Fix in progress] Found why emails have deliverability problems: no domain is verified in the Resend account. Will be fixed alongside the website's domain switch.
