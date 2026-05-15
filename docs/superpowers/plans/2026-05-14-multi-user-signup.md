# Multi-User Sign-up & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add invite-code-gated sign-up and a 4-step onboarding wizard so other musicians can create accounts in GigFlow.

**Architecture:** New `/signup` page validates an invite code then creates a Supabase auth user (a DB trigger auto-creates the `profiles` row). A `/onboarding` wizard collects artist info across 4 steps and writes to `artist_profiles` + `zones` on completion. The middleware gains a guard that routes incomplete users back to `/onboarding`.

**Tech Stack:** Next.js 14 App Router, Supabase SSR (`@supabase/ssr`), TypeScript, Tailwind (inline styles matching existing dark theme)

---

## File Map

| File | Status | Responsibility |
|------|--------|---------------|
| `supabase/migrations/010_invite_codes.sql` | Create | `invite_codes` table, seed data, auto-profile trigger |
| `app/api/auth/validate-code/route.ts` | Create | Checks invite code is valid + active |
| `app/signup/page.tsx` | Create | Invite code + email + password sign-up form |
| `app/onboarding/page.tsx` | Create | 4-step wizard: name/phone, region, links, bio+photo |
| `proxy.ts` | Modify | Allow `/signup` public; guard incomplete users to `/onboarding` |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/010_invite_codes.sql`

> **Note on profiles row creation:** The spec described using a service role client in the sign-up page to insert the `profiles` row immediately after `supabase.auth.signUp()`. This plan uses a `SECURITY DEFINER` DB trigger instead. The trigger fires synchronously on every `auth.users` INSERT, guaranteeing the `profiles` row exists before any downstream code runs — no race condition with session cookie timing, and no service-role call needed in the client. The spec's concern (that the session cookie may not be set immediately after `signUp()`) is fully resolved by the trigger. If for any reason the trigger cannot be applied (e.g., restricted Supabase plan), revert to the service-role insert in `app/signup/page.tsx` after the `signUp()` call.

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/010_invite_codes.sql

-- ============================================================
-- INVITE CODES
-- Reusable beta access codes. No RLS — queried only via
-- service role from the validate-code API route.
-- ============================================================

create table public.invite_codes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  active     boolean not null default true,
  created_at timestamptz default now()
);

-- Seed with 20 reusable beta codes
insert into public.invite_codes (code) values
  ('GIGFLOW-BETA-01'), ('GIGFLOW-BETA-02'), ('GIGFLOW-BETA-03'),
  ('GIGFLOW-BETA-04'), ('GIGFLOW-BETA-05'), ('GIGFLOW-BETA-06'),
  ('GIGFLOW-BETA-07'), ('GIGFLOW-BETA-08'), ('GIGFLOW-BETA-09'),
  ('GIGFLOW-BETA-10'), ('GIGFLOW-BETA-11'), ('GIGFLOW-BETA-12'),
  ('GIGFLOW-BETA-13'), ('GIGFLOW-BETA-14'), ('GIGFLOW-BETA-15'),
  ('GIGFLOW-BETA-16'), ('GIGFLOW-BETA-17'), ('GIGFLOW-BETA-18'),
  ('GIGFLOW-BETA-19'), ('GIGFLOW-BETA-20');

-- ============================================================
-- AUTO-PROFILE TRIGGER
-- When a new auth.users row is created, automatically insert
-- a matching profiles row. This satisfies the FK chain that
-- artist_profiles requires (user_id → profiles.id).
-- Uses SECURITY DEFINER so it runs as the table owner,
-- bypassing RLS on profiles.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

- [ ] **Step 2: Run the migration in Supabase**

Go to the Supabase dashboard → SQL Editor → paste the contents of `010_invite_codes.sql` → Run.

- [ ] **Step 3: Verify**

In the SQL Editor run:
```sql
select code, active from invite_codes order by code;
```
Expected: 20 rows, all `active = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/010_invite_codes.sql
git commit -m "feat: add invite_codes table and auto-profile trigger"
```

---

## Task 2: Validate-Code API Route

**Files:**
- Create: `app/api/auth/validate-code/route.ts`

This is a public endpoint — no auth required. It uses `createServiceClient` (service role) because the `invite_codes` table has no RLS and cannot be read with the anon key.

- [ ] **Step 1: Create the route file**

```typescript
// app/api/auth/validate-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { code } = await request.json();

  if (!code || typeof code !== "string") {
    return NextResponse.json({ valid: false, error: "Code is required" });
  }

  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("invite_codes")
    .select("id")
    .eq("code", code.trim().toUpperCase())
    .eq("active", true)
    .single();

  if (!data) {
    return NextResponse.json({ valid: false, error: "Invalid invite code" });
  }

  return NextResponse.json({ valid: true });
}
```

- [ ] **Step 2: Test it manually with curl**

Start the dev server (`npm run dev`), then:

```bash
# Should return { valid: true }
curl -s -X POST http://localhost:3000/api/auth/validate-code \
  -H "Content-Type: application/json" \
  -d '{"code":"GIGFLOW-BETA-01"}' | jq

# Should return { valid: false, error: "Invalid invite code" }
curl -s -X POST http://localhost:3000/api/auth/validate-code \
  -H "Content-Type: application/json" \
  -d '{"code":"WRONG-CODE"}' | jq
```

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/validate-code/route.ts
git commit -m "feat: add invite code validation API route"
```

---

## Task 3: Middleware Update

**Files:**
- Modify: `proxy.ts`

Two changes: (1) allow `/signup` and `/api/auth/validate-code` without auth, (2) redirect authenticated users with incomplete profiles to `/onboarding`.

- [ ] **Step 1: Read the current proxy.ts**

The relevant section currently looks like:
```typescript
const isPublicRoute =
  pathname.startsWith("/profile/") ||
  pathname === "/api/calendar/ics";
```

And the redirect logic:
```typescript
if (!user && !isLoginPage && !isPublicRoute) { ... redirect to /login }
if (user && isLoginPage && !isPublicRoute) { ... redirect to /dashboard }
```

- [ ] **Step 2: Update `isPublicRoute` to include signup routes**

Replace the `isPublicRoute` block with:
```typescript
const isPublicRoute =
  pathname.startsWith("/profile/") ||
  pathname === "/api/calendar/ics" ||
  pathname === "/signup" ||
  pathname === "/api/auth/validate-code";
```

- [ ] **Step 3: Add the onboarding guard after the existing redirect logic**

This block must be inserted **immediately before the final `return supabaseResponse` statement** that ends the middleware function — not just after the two redirect blocks, since other code may follow them. Place it like this:

```typescript
// ... (existing redirect blocks above) ...

// [INSERT NEW GUARD HERE — see code below]

return supabaseResponse;  // ← this is the final return; guard goes above it
```

After the existing two `if (!user ...)` / `if (user && isLoginPage ...)` blocks, and before `return supabaseResponse`, add:

```typescript
// Guard: authenticated users who haven't completed onboarding
// are redirected to /onboarding. Skip this check on /onboarding
// itself (would cause infinite redirect) and on all API routes.
const isOnboardingRoute = pathname === "/onboarding";
const isApiRoute = pathname.startsWith("/api/");

if (user && !isPublicRoute && !isLoginPage && !isOnboardingRoute && !isApiRoute) {
  const { data: artistProfile } = await supabase
    .from("artist_profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!artistProfile?.display_name) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    return NextResponse.redirect(url);
  }
}
```

**Important pre-condition:** Before adding this guard, confirm in the Supabase dashboard → Authentication → Policies → `artist_profiles` that a SELECT policy exists allowing authenticated users to read their own row (e.g., `using (auth.uid() = user_id)`). The middleware SSR client uses cookie-based auth, so a user-scoped `auth.uid() = user_id` policy works correctly here — the user's session cookie is present when the middleware runs. If NO SELECT policy exists on `artist_profiles`, this query will silently return null for every user, causing an infinite redirect loop to `/onboarding` for all users including Taylor. Add the policy if it is missing before deploying.

- [ ] **Step 4: Verify dev server starts with no TS errors**

```bash
npm run dev
```

Expected: no errors, server starts on port 3000.

- [ ] **Step 5: Manually verify the guard**

- Visit `http://localhost:3000/signup` while logged out → should see the page (not redirect to `/login`)
- Visit `http://localhost:3000/dashboard` while logged out → should redirect to `/login`

- [ ] **Step 6: Commit**

```bash
git add proxy.ts
git commit -m "feat: add signup public route and onboarding guard to middleware"
```

---

## Task 4: Sign-up Page

**Files:**
- Create: `app/signup/page.tsx`

Client component styled to match the existing login page (`app/login/page.tsx`). Flow: validate code inline → submit creates auth user via browser Supabase client → redirect to `/onboarding`.

- [ ] **Step 1: Create the page**

```typescript
// app/signup/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type CodeStatus = "idle" | "checking" | "valid" | "invalid";

export default function SignupPage() {
  const router = useRouter();
  const [code, setCode]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [codeStatus, setCodeStatus] = useState<CodeStatus>("idle");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  // Validate invite code on blur
  async function handleCodeBlur() {
    if (!code.trim()) return;
    setCodeStatus("checking");
    try {
      const res = await fetch("/api/auth/validate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      setCodeStatus(data.valid ? "valid" : "invalid");
    } catch {
      setCodeStatus("invalid");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Re-validate code before submitting
    if (codeStatus !== "valid") {
      const res = await fetch("/api/auth/validate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!data.valid) {
        setCodeStatus("invalid");
        setError("Invalid invite code.");
        return;
      }
      setCodeStatus("valid");
    }

    setLoading(true);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({ email, password });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    router.push("/onboarding");
  }

  const inputStyle = {
    background: "#1e2128",
    border: "1px solid rgba(255,255,255,0.07)",
    color: "#f0ede8",
  };
  const focusBorder = "rgba(212,168,83,0.5)";

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "#0e0f11" }}
    >
      <div
        className="rounded-xl p-8 w-full max-w-sm"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="mb-8">
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.75rem", color: "#d4a853", lineHeight: 1.2 }}>
            GigFlow
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#9a9591" }}>Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Invite Code */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#9a9591" }}>
              Invite Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeStatus("idle"); }}
              onBlur={handleCodeBlur}
              required
              placeholder="GIGFLOW-BETA-01"
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{
                ...inputStyle,
                borderColor: codeStatus === "valid" ? "rgba(76,175,125,0.5)"
                           : codeStatus === "invalid" ? "rgba(226,92,92,0.5)"
                           : "rgba(255,255,255,0.07)",
                letterSpacing: "0.05em",
              }}
              onFocus={(e) => (e.target.style.borderColor = focusBorder)}
            />
            {codeStatus === "valid" && (
              <p className="text-xs mt-1" style={{ color: "#4caf7d" }}>✓ Valid invite code</p>
            )}
            {codeStatus === "invalid" && (
              <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>Invalid invite code</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#9a9591" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = focusBorder)}
              onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.07)")}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#9a9591" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              minLength={6}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = focusBorder)}
              onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.07)")}
            />
          </div>

          {error && (
            <p className="text-sm rounded-lg px-3 py-2" style={{ color: "#e25c5c", backgroundColor: "rgba(226,92,92,0.1)", border: "1px solid rgba(226,92,92,0.2)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
          >
            {loading ? "Creating account…" : "Create Account →"}
          </button>
        </form>

        <p className="text-center mt-6 text-sm" style={{ color: "#5e5c58" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "#d4a853", textDecoration: "underline" }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it renders**

Visit `http://localhost:3000/signup`. Expected: dark card with three fields and GigFlow branding.

- [ ] **Step 3: Test the invite code inline validation**

Type `GIGFLOW-BETA-01` into the code field and tab away. Expected: green "✓ Valid invite code" text appears.

Type `BADCODE` and tab away. Expected: red "Invalid invite code" appears.

- [ ] **Step 4: Commit**

```bash
git add app/signup/page.tsx
git commit -m "feat: add invite-code-gated sign-up page"
```

---

## Task 5: Onboarding Wizard

**Files:**
- Create: `app/onboarding/page.tsx`

4-step client component. All state lives in `useState`. On step 4 completion: uploads photo (if provided) to `artist-photos` storage, then upserts `artist_profiles` and inserts `zones` via the browser Supabase client.

- [ ] **Step 1: Verify the `artist-photos` storage bucket exists**

In the Supabase dashboard → Storage → Buckets. You should see a bucket named `artist-photos`. If it exists, proceed to Step 2.

If it does NOT exist (unlikely — it was created in an earlier migration), create it manually: click "New bucket", name it `artist-photos`, set it to **public**, and add a policy allowing authenticated users to upload to `{user_id}/*`.

- [ ] **Step 2: Create the page**

```typescript
// app/onboarding/page.tsx
"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Step = 1 | 2 | 3 | 4;

interface FormData {
  // Step 1
  displayName: string;
  phone: string;
  // Step 2
  city: string;
  zipCode: string;
  radiusMi: number;
  // Step 3
  website: string;
  youtube: string;
  instagram: string;
  // Step 4
  bio: string;
  photoFile: File | null;
  photoPreview: string | null;
}

const INITIAL: FormData = {
  displayName: "", phone: "",
  city: "", zipCode: "", radiusMi: 30,
  website: "", youtube: "", instagram: "",
  bio: "", photoFile: null, photoPreview: null,
};

function ProgressBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {[1, 2, 3, 4].map((s) => (
        <div
          key={s}
          className="h-1 flex-1 rounded-full transition-colors duration-300"
          style={{ backgroundColor: s <= step ? "#9b7fe8" : "#262b33" }}
        />
      ))}
      <span className="text-xs ml-3 shrink-0" style={{ color: "#9a9591" }}>
        Step {step} of 4
      </span>
    </div>
  );
}

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "#f0ede8",
};

const labelStyle = { color: "#9a9591" };

export default function OnboardingPage() {
  const router  = useRouter();
  const [step, setStep]   = useState<Step>(1);
  const [form, setForm]   = useState<FormData>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function update(fields: Partial<FormData>) {
    setForm((prev) => ({ ...prev, ...fields }));
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    update({
      photoFile: file,
      photoPreview: URL.createObjectURL(file),
    });
  }

  async function finish() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Session expired. Please sign in again."); setSaving(false); return; }

    // Upload photo if provided
    let photoUrl: string | null = null;
    if (form.photoFile) {
      const ext  = form.photoFile.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("artist-photos")
        .upload(path, form.photoFile, { upsert: true });
      if (uploadError) {
        setError("Photo upload failed: " + uploadError.message);
        setSaving(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("artist-photos").getPublicUrl(path);
      photoUrl = urlData.publicUrl;
    }

    // Upsert artist_profiles
    const socialLinks: Record<string, string> = {};
    if (form.website)   socialLinks.website   = form.website;
    if (form.youtube)   socialLinks.youtube   = form.youtube;
    if (form.instagram) socialLinks.instagram = form.instagram;

    const { error: profileError } = await supabase
      .from("artist_profiles")
      .upsert({
        user_id:      user.id,
        display_name: form.displayName.trim(),
        phone:        form.phone.trim() || null,
        bio:          form.bio.trim()   || null,
        social_links: socialLinks,
        ...(photoUrl ? { photo_url: photoUrl } : {}),
      }, { onConflict: "user_id" });

    if (profileError) {
      setError("Failed to save profile: " + profileError.message);
      setSaving(false);
      return;
    }

    // Insert zone (delete-then-insert to handle re-submission safely)
    // zones supports multiple rows per user, so upsert by user_id alone isn't
    // appropriate. Instead, delete any existing onboarding zone before inserting.
    await supabase.from("zones").delete().eq("user_id", user.id);

    const { error: zoneError } = await supabase
      .from("zones")
      .insert({
        user_id:   user.id,
        name:      form.city.trim(),
        zip_code:  form.zipCode.trim() || null,
        radius_mi: form.radiusMi,
      });

    if (zoneError) {
      setError("Failed to save region: " + zoneError.message);
      setSaving(false);
      return;
    }

    router.push("/dashboard");
  }

  const card = {
    backgroundColor: "#16181c",
    border: "1px solid rgba(255,255,255,0.07)",
  };

  const continueBtn = {
    backgroundColor: "#9b7fe8",
    color: "#ffffff",
  };

  const backBtn = {
    backgroundColor: "#262b33",
    color: "#9a9591",
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#0e0f11" }}>
      <div className="rounded-xl p-8 w-full max-w-sm" style={card}>
        <div className="mb-6">
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.5rem", color: "#d4a853" }}>
            GigFlow
          </h1>
        </div>

        <ProgressBar step={step} />

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div>
            <h2 className="text-base font-semibold mb-1" style={{ color: "#f0ede8" }}>Tell us about you</h2>
            <p className="text-xs mb-5" style={{ color: "#9a9591" }}>This shows up in your pitch emails.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>Artist / Stage Name</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => update({ displayName: e.target.value })}
                  placeholder="Taylor Anderson"
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>Phone Number</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update({ phone: e.target.value })}
                  placeholder="(503) 555-0123"
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={inputStyle}
                />
              </div>
            </div>
            <button
              onClick={() => { if (!form.displayName.trim()) return; setStep(2); }}
              disabled={!form.displayName.trim()}
              className="w-full mt-6 rounded-lg py-2 text-sm font-semibold disabled:opacity-40"
              style={continueBtn}
            >
              Continue →
            </button>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div>
            <h2 className="text-base font-semibold mb-1" style={{ color: "#f0ede8" }}>Where are you based?</h2>
            <p className="text-xs mb-5" style={{ color: "#9a9591" }}>We'll use this to find venues near you.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>Home City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => update({ city: e.target.value })}
                  placeholder="Newberg, OR"
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={inputStyle}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={labelStyle}>Zip Code</label>
                  <input
                    type="text"
                    value={form.zipCode}
                    onChange={(e) => update({ zipCode: e.target.value })}
                    placeholder="97132"
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={inputStyle}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={labelStyle}>Radius (miles)</label>
                  <select
                    value={form.radiusMi}
                    onChange={(e) => update({ radiusMi: Number(e.target.value) })}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={inputStyle}
                  >
                    {[10, 20, 30, 50, 75, 100].map((r) => (
                      <option key={r} value={r}>{r} mi</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(1)} className="flex-1 rounded-lg py-2 text-sm" style={backBtn}>← Back</button>
              <button
                onClick={() => { if (!form.city.trim()) return; setStep(3); }}
                disabled={!form.city.trim()}
                className="flex-[2] rounded-lg py-2 text-sm font-semibold disabled:opacity-40"
                style={continueBtn}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div>
            <h2 className="text-base font-semibold mb-1" style={{ color: "#f0ede8" }}>Your links</h2>
            <p className="text-xs mb-5" style={{ color: "#9a9591" }}>Added to your pitch emails automatically. All optional.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>Website</label>
                <input type="url" value={form.website} onChange={(e) => update({ website: e.target.value })} placeholder="https://yourname.com" className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>YouTube (sample video link)</label>
                <input type="url" value={form.youtube} onChange={(e) => update({ youtube: e.target.value })} placeholder="https://youtube.com/watch?v=..." className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>Instagram</label>
                <input type="text" value={form.instagram} onChange={(e) => update({ instagram: e.target.value })} placeholder="@yourhandle" className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(2)} className="flex-1 rounded-lg py-2 text-sm" style={backBtn}>← Back</button>
              <button onClick={() => setStep(4)} className="flex-[2] rounded-lg py-2 text-sm font-semibold" style={continueBtn}>Continue →</button>
            </div>
            <button onClick={() => setStep(4)} className="w-full mt-3 text-xs" style={{ color: "#5e5c58" }}>Skip for now</button>
          </div>
        )}

        {/* ── Step 4 ── */}
        {step === 4 && (
          <div>
            <h2 className="text-base font-semibold mb-1" style={{ color: "#f0ede8" }}>Almost there — bio & photo</h2>
            <p className="text-xs mb-5" style={{ color: "#9a9591" }}>Shows on your public profile page. Both optional.</p>

            {/* Photo upload */}
            <div className="mb-4">
              <label className="block text-xs font-medium mb-2" style={labelStyle}>Profile Photo</label>
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                  style={{ background: "#262b33", border: "2px dashed rgba(255,255,255,0.15)" }}
                >
                  {form.photoPreview
                    ? <img src={form.photoPreview} alt="Preview" className="w-full h-full object-cover" />
                    : <span className="text-2xl">🎸</span>
                  }
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg px-3 py-1.5 text-xs"
                    style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#9a9591" }}
                  >
                    {form.photoFile ? "Change photo" : "Upload photo"}
                  </button>
                  <p className="text-xs mt-1" style={{ color: "#5e5c58" }}>JPG or PNG, up to 5MB</p>
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
            </div>

            {/* Bio */}
            <div className="mb-5">
              <label className="block text-xs font-medium mb-1" style={labelStyle}>Bio</label>
              <textarea
                value={form.bio}
                onChange={(e) => update({ bio: e.target.value })}
                placeholder="I'm a singer-songwriter based in the Pacific Northwest…"
                rows={3}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                style={inputStyle}
              />
            </div>

            {error && (
              <p className="text-xs rounded-lg px-3 py-2 mb-4" style={{ color: "#e25c5c", backgroundColor: "rgba(226,92,92,0.1)", border: "1px solid rgba(226,92,92,0.2)" }}>
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className="flex-1 rounded-lg py-2 text-sm" style={backBtn}>← Back</button>
              <button
                onClick={finish}
                disabled={saving}
                className="flex-[2] rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
              >
                {saving ? "Saving…" : "Let's go! 🎸"}
              </button>
            </div>
            <button onClick={finish} disabled={saving} className="w-full mt-3 text-xs disabled:opacity-50" style={{ color: "#5e5c58" }}>Skip for now</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it renders**

Visit `http://localhost:3000/onboarding` while signed in. Expected: dark card with progress bar and step 1 fields.

- [ ] **Step 4: Verify step navigation**

- Fill in a name → click Continue → step 2 shows, progress bar is 2/4 filled
- Click Back → returns to step 1 with name still filled in
- Continue through steps 3 and 4, verify Skip works on steps 3 and 4

- [ ] **Step 5: Commit**

```bash
git add app/onboarding/page.tsx
git commit -m "feat: add 4-step onboarding wizard with photo upload"
```

---

## Task 6: End-to-End Verification

No code changes — manual test of the full sign-up → onboard → dashboard flow.

- [ ] **Step 1: Sign up with a valid code**

1. Open `http://localhost:3000/signup` in an incognito window
2. Enter `GIGFLOW-BETA-05`, a new email, and a password
3. Click Create Account
4. Expected: redirected to `/onboarding`

- [ ] **Step 2: Complete onboarding**

1. Step 1: enter a name and phone → Continue
2. Step 2: enter a city and zip → Continue
3. Step 3: skip (click Skip for now)
4. Step 4: upload a photo, enter a bio → Let's go!
5. Expected: redirected to `/dashboard`

- [ ] **Step 3: Verify data was saved**

In Supabase dashboard → Table Editor → `artist_profiles`:
- New row should exist with the name, phone, bio, and photo_url you entered

In `zones`:
- New row should exist with the city and zip you entered

- [ ] **Step 4: Verify middleware guard**

Sign out, then visit `http://localhost:3000/dashboard` with the new account's credentials:
- Sign in via `/login`
- Expected: goes to `/dashboard` (not redirected to `/onboarding` again — profile is complete)

- [ ] **Step 5: Test abandoned-onboarding recovery**

1. Sign up with another new email (`GIGFLOW-BETA-06`)
2. Land on `/onboarding`, then close the tab without completing
3. Reopen the app and sign in with that email
4. Expected: redirected to `/onboarding` (profile is incomplete)

- [ ] **Step 6: Final commit and push**

```bash
git push
```

---

## Done ✓

The app now supports multiple users. Share any `GIGFLOW-BETA-XX` code with a musician and they can sign up at `/signup`, complete onboarding, and start using their own pipeline — fully isolated from everyone else's data via Row Level Security.
