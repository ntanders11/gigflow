# Multi-User Sign-up & Onboarding — Design Spec

**Date:** 2026-05-14  
**Status:** Approved

---

## Overview

GigFlow is currently a single-user app. This spec covers adding invite-code-gated sign-up and a full-profile onboarding wizard so other musicians can create accounts.

The database is already multi-tenant ready — all tables have `user_id` columns and Row Level Security policies in place. No schema changes are needed for data isolation.

---

## Access Model

- **Invite-only beta** using a fixed list of reusable invite codes
- Codes are stored in a new `invite_codes` table, seeded with ~20 codes
- Codes are **reusable** — any number of people can sign up with the same code
- If a code is in the table and `active = true`, it's valid
- No per-use tracking, no admin UI needed
- Taylor shares codes manually (text, DM, email)

---

## New Pages & Routes

### `/signup` (public)
- Accessible without authentication (added to middleware allowlist alongside `/login`)
- Fields: Invite Code, Email, Password
- On submit:
  1. Validate invite code against `invite_codes` table via API route
  2. Create Supabase auth user
  3. Redirect to `/onboarding`
- Inline validation: code field shows green checkmark when valid, red error when not
- "Already have an account? Sign in" link at bottom

### `/onboarding` (auth required)
- 4-step wizard, one step per view
- Progress bar fills across steps
- Back button on steps 2–4
- "Skip for now" on steps 3 and 4 (optional fields)
- On final step completion: writes to `profiles` and `zones` tables, redirects to `/dashboard`

### Middleware update
- `/signup` added to public routes
- After authentication, check if user's profile has `display_name` set
- If not → redirect to `/onboarding` instead of `/dashboard`
- This handles users who closed the browser mid-wizard

---

## Onboarding Wizard Steps

### Step 1 — Artist Info
- Artist / Stage Name (required → saved to `profiles.display_name`)
- Phone Number (→ `profiles.phone`)

### Step 2 — Your Region
- Home City (text → `zones.name`)
- Zip Code (→ `zones.zip_code`)
- Search Radius in miles, default 30 (→ `zones.radius_mi`)

### Step 3 — Links *(optional, skippable)*
- Website (→ `profiles.social_links.website`)
- YouTube sample video link (→ `profiles.social_links.youtube`)
- Instagram handle (→ `profiles.social_links.instagram`)

### Step 4 — Bio *(optional, skippable)*
- Short bio / blurb (2–3 sentences, → `profiles.bio`)
- Used in pitch email templates

Final button: "Let's go! 🎸" → creates profile + zone rows → redirects to `/dashboard`

---

## Database Changes

### New table: `invite_codes`
```sql
create table public.invite_codes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  active     boolean not null default true,
  created_at timestamptz default now()
);
```
- No RLS needed (validated via service role in API route)
- Seeded with ~20 reusable codes (e.g. `GIGFLOW-BETA-01` through `GIGFLOW-BETA-20`)

### New migration: `010_invite_codes.sql`

---

## New API Route

### `POST /api/auth/validate-code`
- Body: `{ code: string }`
- Queries `invite_codes` where `code = input AND active = true`
- Returns `{ valid: true }` or `{ valid: false, error: "Invalid invite code" }`
- Uses service role client (bypasses RLS)
- Rate-limited by Vercel's built-in edge protections

---

## Visual Design

- Matches existing GigFlow dark theme (`#0e0f11` background, `#16181c` cards, `#d4a853` gold)
- Sign-up page mirrors the login page layout
- Onboarding uses purple accent (`#9b7fe8`) for progress bar and Continue buttons
- Final "Let's go!" button uses gold (`#d4a853`) to match the dashboard feel

---

## Out of Scope

- Email verification (Supabase handles this optionally; not required for beta)
- Password reset (Supabase's built-in flow handles this)
- Admin UI for code management
- Paid tiers or subscription gating
- Per-use code tracking

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `supabase/migrations/010_invite_codes.sql` | Create — new table + seed data |
| `app/signup/page.tsx` | Create — sign-up page |
| `app/onboarding/page.tsx` | Create — 4-step wizard |
| `app/api/auth/validate-code/route.ts` | Create — code validation endpoint |
| `proxy.ts` | Modify — allow `/signup`, redirect incomplete profiles to `/onboarding` |
