# Multi-User Sign-up & Onboarding — Design Spec

**Date:** 2026-05-14  
**Status:** Approved

---

## Overview

GigFlow is currently a single-user app. This spec covers adding invite-code-gated sign-up and a full-profile onboarding wizard so other musicians can create accounts.

The database is already multi-tenant ready — all tables have `user_id` columns and Row Level Security policies in place. No schema changes are needed for data isolation.

---

## Table Structure (relevant tables)

- **`profiles`** — base auth extension (`id`, `display_name`, `email`, `created_at`). One row per auth user; must exist before `artist_profiles` can be created. `profiles.display_name` is not used by any current feature and is left null; it exists only to satisfy the FK chain.
- **`artist_profiles`** — booking/EPK profile (`user_id` → `profiles.id`, `display_name`, `phone`, `bio`, `social_links` jsonb, etc.). **`artist_profiles.display_name` is the authoritative artist/stage name** — it is what email templates and the pipeline read. This is where all onboarding data is written.
- **`zones`** — geographic region (`user_id`, `name`, `zip_code`, `radius_mi`). Created during onboarding step 2.

---

## Access Model

- **Invite-only beta** using a fixed list of reusable invite codes
- Codes are stored in a new `invite_codes` table, seeded with ~20 codes
- Codes are **reusable** — any number of people can sign up with the same code
- A code is valid if it exists in the table with `active = true`
- No per-use tracking, no admin UI needed
- Taylor shares codes manually (text, DM, email)

---

## New Pages & Routes

### `/signup` (public)
- Accessible without authentication
- Added to `proxy.ts` via `isPublicRoute`: `pathname === "/signup"` (same condition as `/api/auth/validate-code`)
- Fields: Invite Code, Email, Password
- On submit:
  1. Call `POST /api/auth/validate-code` to check the code
  2. Create Supabase auth user via `supabase.auth.signUp()`
  3. Insert a row into `profiles` using the **service role client** (RLS on `profiles` requires `auth.uid() = id`; the session cookie may not be set yet immediately after signUp, so the anon/SSR client is unreliable here — service role bypasses this)
  4. Redirect to `/onboarding`
- Inline code validation: green checkmark when valid, red error when not
- "Already have an account? Sign in" link at bottom

### `/onboarding` (auth required)
- 4-step wizard, client-side React state carries data between steps (no refresh loss risk — user is guided linearly)
- Progress bar at top fills across steps
- Back button on steps 2–4
- "Skip for now" on steps 3 and 4 (optional fields)
- On final step completion:
  1. Upsert `artist_profiles` row (all collected fields)
  2. Insert `zones` row
  3. Redirect to `/dashboard`

### `/api/auth/validate-code` (public API route)
- Must be excluded from auth-gating in `proxy.ts` — logged-out users on `/signup` need to call it
- Add to `isPublicRoute`: `pathname === "/api/auth/validate-code"`

### Middleware update (`proxy.ts`)
- `/signup` and `/api/auth/validate-code` both added to `isPublicRoute`
- After authentication, and **only when `pathname` is not `/onboarding`** (to prevent an infinite redirect loop), check if user has an `artist_profiles` row with `display_name` set:
  - If `artist_profiles` row **does not exist** → redirect to `/onboarding`
  - If row exists but `display_name` is null/empty → redirect to `/onboarding`
  - If row exists with `display_name` set → proceed normally
- The guard is skipped on `/onboarding` and all `/api/*` routes
- This handles mid-wizard abandonment: user is always routed back to `/onboarding` until setup is complete

---

## Onboarding Wizard Steps

State is held in React (`useState`) across all 4 steps. A single upsert/insert fires on step 4 completion. **If the user abandons mid-wizard and returns later, they restart from step 1** — no partial saves. This is intentional for beta simplicity; the data entry is short enough that restarting is not a significant burden.

### Step 1 — Artist Info *(required)*
- Artist / Stage Name → `artist_profiles.display_name`
- Phone Number → `artist_profiles.phone`

### Step 2 — Your Region *(required)*
- Home City (text) → `zones.name`
- Zip Code → `zones.zip_code`
- Search Radius (miles, default 30) → `zones.radius_mi`

### Step 3 — Links *(optional, skippable)*
- Website → `artist_profiles.social_links.website`
- YouTube sample video link → `artist_profiles.social_links.youtube`
- Instagram handle → `artist_profiles.social_links.instagram`

### Step 4 — Bio & Photo *(optional, skippable)*
- Profile photo upload → uploaded to the `artist-photos` Supabase storage bucket (path: `{user_id}/avatar`), URL saved to `artist_profiles.photo_url`
- Short bio / blurb (2–3 sentences) → `artist_profiles.bio`
- Both used on the public profile/EPK page

Final button: **"Let's go! 🎸"** → upserts `artist_profiles` (including `photo_url` if uploaded) + inserts `zones` → redirects to `/dashboard`

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

-- Seed with reusable beta codes
insert into public.invite_codes (code) values
  ('GIGFLOW-BETA-01'), ('GIGFLOW-BETA-02'), ('GIGFLOW-BETA-03'),
  ('GIGFLOW-BETA-04'), ('GIGFLOW-BETA-05'), ('GIGFLOW-BETA-06'),
  ('GIGFLOW-BETA-07'), ('GIGFLOW-BETA-08'), ('GIGFLOW-BETA-09'),
  ('GIGFLOW-BETA-10'), ('GIGFLOW-BETA-11'), ('GIGFLOW-BETA-12'),
  ('GIGFLOW-BETA-13'), ('GIGFLOW-BETA-14'), ('GIGFLOW-BETA-15'),
  ('GIGFLOW-BETA-16'), ('GIGFLOW-BETA-17'), ('GIGFLOW-BETA-18'),
  ('GIGFLOW-BETA-19'), ('GIGFLOW-BETA-20');
```

- **No RLS** on this table — it is queried exclusively via the service role client in the API route. The anon key cannot read it.
- Migration file: `010_invite_codes.sql` *(note: existing migrations have a pre-existing numbering collision — two files are named `003_*`. This is a known state. `010_` is the correct next number and avoids further conflicts. Migrations are applied by filename order.)*

---

## API Route: `POST /api/auth/validate-code`

- **Auth:** none required (public endpoint)
- **Client:** Supabase service role client (required — anon key cannot read `invite_codes`)
- **Body:** `{ code: string }`
- **Logic:** query `invite_codes` where `code = input AND active = true`
- **Response:**
  - `200 { valid: true }` — code exists and is active
  - `200 { valid: false, error: "Invalid invite code" }` — not found or inactive

---

## Visual Design

- Sign-up page mirrors the existing login page (same card layout, same dark theme)
- Onboarding wizard uses purple accent (`#9b7fe8`) for progress bar and Continue buttons
- Final "Let's go!" button uses gold (`#d4a853`) to match the dashboard
- GigFlow wordmark in serif gold on each wizard step for continuity

---

## Out of Scope

- Email verification (Supabase handles this optionally; not required for beta)
- Password reset (Supabase's built-in flow handles this)
- Admin UI for code management
- Paid tiers or subscription gating
- Per-use invite code tracking

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `supabase/migrations/010_invite_codes.sql` | Create — new table + seed data |
| `app/signup/page.tsx` | Create — sign-up page |
| `app/onboarding/page.tsx` | Create — 4-step wizard |
| `app/api/auth/validate-code/route.ts` | Create — code validation endpoint |
| `proxy.ts` | Modify — public routes + onboarding redirect logic |
