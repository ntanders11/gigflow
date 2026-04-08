# Auto Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically send a follow-up email to any venue that's been in "contacted" stage for 5+ days with no reply, running once daily via Vercel cron.

**Architecture:** A Next.js API route (`/api/venues/follow-up`) queries Supabase for eligible venues, sends follow-up emails via Resend, logs interactions (type: `follow_up`), and updates `last_contacted_at`. A Vercel cron job calls this route every morning at 8 AM Pacific. The route is protected by Vercel's built-in `CRON_SECRET`. A venue only ever receives one follow-up — enforced by checking the interactions table for an existing `follow_up` type entry. A required DB migration adds `follow_up` to the `interaction_type` enum before the route goes live.

**Tech Stack:** Next.js App Router API routes, Supabase service client (`createServiceClient` from `@/lib/supabase/server`), Resend Node SDK, Vercel Cron

---

## File Map

### New Files
- `app/api/venues/follow-up/route.ts` — POST handler: finds eligible venues, sends follow-up emails, logs interactions, updates last_contacted_at
- `vercel.json` — Vercel cron config (calls the route daily at 8 AM Pacific / 16:00 UTC)
- `supabase/migrations/003_followup_interaction_type.sql` — adds `follow_up` to the `interaction_type` enum

### Modified Files
- None — `.env.local` is never committed; `CRON_SECRET` is auto-injected by Vercel in production

---

## Task 1: Add `follow_up` to the interaction_type enum

**Files:**
- Create: `supabase/migrations/003_followup_interaction_type.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/003_followup_interaction_type.sql
ALTER TYPE interaction_type ADD VALUE IF NOT EXISTS 'follow_up';
```

- [ ] **Step 2: Run it in Supabase**

Go to the Supabase dashboard → SQL Editor → paste and run the migration.

Expected: no error. If it says `already exists`, that's fine — the `IF NOT EXISTS` guard handles it.

- [ ] **Step 3: Verify**

```sql
SELECT unnest(enum_range(NULL::interaction_type));
```

Expected output includes: `email`, `call`, `in_person`, `note`, `follow_up`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/003_followup_interaction_type.sql
git commit -m "feat: add follow_up to interaction_type enum"
```

---

## Task 2: Create the follow-up API route

**Files:**
- Create: `app/api/venues/follow-up/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// app/api/venues/follow-up/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function buildFollowUpBody(venueName: string): string {
  return `Hi there,

I wanted to follow up on my email from last week about playing at ${venueName}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.

Here's my performance video again if it's helpful: https://youtu.be/JaPOuz1R0HI?si=lo5JhEbgowL2g5JU

Happy to work around your schedule. Thanks for your time!

Taylor Anderson
(503) 997-3586
taylorandersonmusic.com`;
}

export async function POST(request: NextRequest) {
  // Vercel injects Authorization: Bearer <CRON_SECRET> on cron invocations
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  // Get contacted venues last touched 5+ days ago with an email address
  const { data: venues, error: venueError } = await supabase
    .from("venues")
    .select("id, name, contact_email, user_id")
    .eq("stage", "contacted")
    .not("contact_email", "is", null)
    .lt("last_contacted_at", fiveDaysAgo);

  if (venueError) {
    return NextResponse.json({ error: venueError.message }, { status: 500 });
  }

  if (!venues || venues.length === 0) {
    return NextResponse.json({ sent: 0, message: "No venues need follow-up" });
  }

  // Filter out venues that already received a follow-up
  const venueIds = venues.map((v) => v.id);
  const { data: existingFollowUps } = await supabase
    .from("interactions")
    .select("venue_id")
    .in("venue_id", venueIds)
    .eq("type", "follow_up");

  const alreadyFollowedUp = new Set(
    (existingFollowUps ?? []).map((i) => i.venue_id)
  );

  const eligible = venues.filter((v) => !alreadyFollowedUp.has(v.id));

  if (eligible.length === 0) {
    return NextResponse.json({ sent: 0, message: "All contacted venues already received a follow-up" });
  }

  const now = new Date().toISOString();
  const results: { venue: string; status: string }[] = [];

  for (const venue of eligible) {
    const subject = `Following up — live music inquiry for ${venue.name}`;
    const body = buildFollowUpBody(venue.name);
    const htmlBody = body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#4a9d7a;">$1</a>')
      .replace(/\n/g, "<br>");

    const { data: sendData, error: sendError } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: venue.contact_email!,
      subject,
      text: body,
      html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${htmlBody}</div>`,
    });

    if (sendError) {
      results.push({ venue: venue.name, status: `error: ${sendError.message}` });
      continue;
    }

    // Log interaction
    await supabase.from("interactions").insert({
      venue_id: venue.id,
      user_id: venue.user_id,
      type: "follow_up",
      email_subject: subject,
      email_sent: true,
      resend_id: sendData?.id ?? null,
      occurred_at: now,
    });

    // Update last_contacted_at
    await supabase
      .from("venues")
      .update({ last_contacted_at: now })
      .eq("id", venue.id);

    results.push({ venue: venue.name, status: "sent" });
  }

  return NextResponse.json({
    sent: results.filter((r) => r.status === "sent").length,
    results,
  });
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd /Users/tayloranderson/gigflow && PATH=/usr/local/bin:$PATH npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add app/api/venues/follow-up/route.ts
git commit -m "feat: add auto follow-up API route"
```

---

## Task 3: Set up Vercel cron job

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/venues/follow-up",
      "schedule": "0 16 * * *"
    }
  ]
}
```

`0 16 * * *` = 16:00 UTC = 8:00 AM Pacific (PST). Adjust to `0 15 * * *` in summer (PDT).

Vercel automatically injects `Authorization: Bearer <CRON_SECRET>` on every cron invocation. `CRON_SECRET` is auto-generated by Vercel — no manual setup needed. You can find its value in the Vercel dashboard under Settings → Environment Variables after first deploy.

- [ ] **Step 2: Verify build passes**

```bash
cd /Users/tayloranderson/gigflow && PATH=/usr/local/bin:$PATH npm run build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat: add vercel cron for daily follow-up emails"
```

---

## Task 4: Manual test

- [ ] **Step 1: Get CRON_SECRET from Vercel dashboard**

After deploying to Vercel: Settings → Environment Variables → copy `CRON_SECRET`.

For local testing, add it to `.env.local` temporarily (do NOT commit):
```
CRON_SECRET=<paste value from Vercel>
```

- [ ] **Step 2: Start dev server**

```bash
cd /Users/tayloranderson/gigflow && PATH=/usr/local/bin:$PATH npm run dev
```

- [ ] **Step 3: Test the endpoint manually**

```bash
curl -s -X POST http://localhost:3000/api/venues/follow-up \
  -H "Authorization: Bearer <your-cron-secret>" \
  | python3 -m json.tool
```

Expected (since venues were just contacted today — not 5 days ago yet):
```json
{
  "sent": 0,
  "message": "No venues need follow-up"
}
```

This confirms the route is working — no venues qualify yet because they were just emailed.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete auto follow-up system"
```
