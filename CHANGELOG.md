# GigFlow Changelog

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
