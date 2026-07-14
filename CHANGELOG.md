# StageReach Changelog

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
