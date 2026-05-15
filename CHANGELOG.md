# GigFlow Changelog

## 2026-05-14
- [Feature] Multi-user sign-up: other musicians can now create GigFlow accounts using an invite code at /signup
- [Feature] 4-step onboarding wizard at /onboarding collects artist name, location, social links, and profile photo
- [Feature] Middleware now routes new users to onboarding until their profile is complete
- [Feature] 20 reusable beta invite codes (GIGFLOW-BETA-01 through GIGFLOW-BETA-20) — run migration 010_invite_codes.sql in the Supabase SQL Editor to activate them

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
