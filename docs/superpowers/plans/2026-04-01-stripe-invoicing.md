# Stripe Invoicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Taylor to create and send Stripe invoices to venues directly from GigFlow, supporting full or deposit payments, with automatic payment detection via webhook and manual fallback.

**Architecture:** A `invoices` table stores invoice records linked to venues. A set of Next.js API routes handle Stripe invoice creation, sending, and webhook processing. The venue detail page and dashboard get an "Invoice" button and payment status display.

**Tech Stack:** Stripe Node SDK, Next.js App Router API routes, Supabase (postgres + RLS), React (client components)

---

## File Map

### New Files
- `supabase/migrations/003_invoices.sql` — invoices table + RLS
- `app/api/invoices/route.ts` — POST: create invoice, GET: list invoices for a venue
- `app/api/invoices/[id]/route.ts` — GET: single invoice, PATCH: mark paid manually
- `app/api/invoices/[id]/send/route.ts` — POST: send invoice via Stripe
- `app/api/stripe/webhook/route.ts` — POST: handle Stripe payment webhooks
- `components/invoice/InvoiceModal.tsx` — modal to create/send invoice from venue detail
- `components/invoice/InvoiceStatusBadge.tsx` — small badge showing paid/unpaid/sent status
- `lib/stripe.ts` — Stripe client singleton

### Modified Files
- `types/index.ts` — add Invoice type
- `components/venue/VenueDetail.tsx` — add Invoice button + invoice list
- `app/(protected)/dashboard/page.tsx` — add "Unpaid Invoices" stat card
- `.env.local` — add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

---

## Task 1: Install Stripe and add environment variables

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `.env.local`

- [ ] **Step 1: Install Stripe SDK**

```bash
cd /Users/tayloranderson/gigflow && npm install stripe
```

- [ ] **Step 2: Add env vars to .env.local**

Add these lines to `.env.local`:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Taylor needs to:
1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy the "Secret key" (starts with `sk_test_`)
3. Paste it as STRIPE_SECRET_KEY

(STRIPE_WEBHOOK_SECRET is set up in Task 6)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install stripe sdk"
```

---

## Task 2: Create Stripe client singleton

**Files:**
- Create: `lib/stripe.ts`

- [ ] **Step 1: Create the file**

```typescript
// lib/stripe.ts
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/tayloranderson/gigflow && npm run build 2>&1 | head -20
```

Expected: no errors referencing stripe.ts

- [ ] **Step 3: Commit**

```bash
git add lib/stripe.ts
git commit -m "feat: add stripe client singleton"
```

---

## Task 3: Database migration — invoices table

**Files:**
- Create: `supabase/migrations/003_invoices.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/003_invoices.sql

create type invoice_status as enum (
  'draft',     -- Created but not sent yet
  'sent',      -- Sent to venue via Stripe
  'paid',      -- Payment received
  'void'       -- Cancelled
);

create type payment_type as enum (
  'full',      -- Full payment
  'deposit'    -- Partial deposit
);

create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references public.venues(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,

  -- Invoice details
  amount_cents        integer not null,        -- Amount in cents (e.g. 50000 = $500)
  payment_type        payment_type not null default 'full',
  event_date          date,
  package_label       text,                    -- "Solo", "Trio", "Five Piece Band"
  description         text,                    -- Optional custom note

  -- Status
  status              invoice_status not null default 'draft',
  paid_at             timestamptz,

  -- Stripe references
  stripe_invoice_id   text unique,             -- Stripe's invoice ID
  stripe_invoice_url  text,                    -- Hosted invoice URL for the venue

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function update_updated_at();

create index idx_invoices_venue_id on public.invoices(venue_id);
create index idx_invoices_user_id  on public.invoices(user_id);
create index idx_invoices_status   on public.invoices(status);

alter table public.invoices enable row level security;

create policy "own invoices only"
  on public.invoices
  for all
  using (auth.uid() = user_id);
```

- [ ] **Step 2: Run migration in Supabase**

Go to https://supabase.com → SQL Editor → New query → paste the file contents → Run

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/003_invoices.sql
git commit -m "feat: add invoices table migration"
```

---

## Task 4: Add Invoice type to types/index.ts

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add types**

Append to the bottom of `types/index.ts`:

```typescript
// ============================================================
// INVOICES
// ============================================================

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";
export type PaymentType = "full" | "deposit";

export interface Invoice {
  id: string;
  venue_id: string;
  user_id: string;
  amount_cents: number;
  payment_type: PaymentType;
  event_date: string | null;
  package_label: string | null;
  description: string | null;
  status: InvoiceStatus;
  paid_at: string | null;
  stripe_invoice_id: string | null;
  stripe_invoice_url: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /Users/tayloranderson/gigflow && npm run build 2>&1 | grep -i error | head -10
```

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add Invoice types"
```

---

## Task 5: Invoice API routes

**Files:**
- Create: `app/api/invoices/route.ts`
- Create: `app/api/invoices/[id]/route.ts`
- Create: `app/api/invoices/[id]/send/route.ts`

- [ ] **Step 1: Create app/api/invoices/route.ts**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

// GET /api/invoices?venue_id=xxx — list invoices for a venue
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const venueId = request.nextUrl.searchParams.get("venue_id");
  if (!venueId) return NextResponse.json({ error: "venue_id required" }, { status: 400 });

  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("venue_id", venueId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/invoices — create a new invoice (draft, not sent yet)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { venue_id, amount_cents, payment_type, event_date, package_label, description } = body;

  if (!venue_id || !amount_cents) {
    return NextResponse.json({ error: "venue_id and amount_cents are required" }, { status: 400 });
  }

  const serviceClient = await createServiceClient();
  const { data, error } = await serviceClient
    .from("invoices")
    .insert({
      venue_id,
      user_id: user.id,
      amount_cents,
      payment_type: payment_type ?? "full",
      event_date: event_date ?? null,
      package_label: package_label ?? null,
      description: description ?? null,
      status: "draft",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 2: Create app/api/invoices/[id]/route.ts**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/invoices/[id] — manually mark as paid or void
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.status === "paid") {
    updates.status = "paid";
    updates.paid_at = new Date().toISOString();
  } else if (body.status === "void") {
    updates.status = "void";
  }

  const { data, error } = await supabase
    .from("invoices")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 3: Create app/api/invoices/[id]/send/route.ts**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

// POST /api/invoices/[id]/send — create Stripe invoice and send to venue
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { venue_email, venue_name } = body;

  if (!venue_email) {
    return NextResponse.json({ error: "venue_email is required" }, { status: 400 });
  }

  // Load the invoice
  const { data: invoice, error: loadError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (loadError || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  try {
    // Find or create Stripe customer for this venue email
    const existingCustomers = await stripe.customers.list({ email: venue_email, limit: 1 });
    let customer = existingCustomers.data[0];
    if (!customer) {
      customer = await stripe.customers.create({
        email: venue_email,
        name: venue_name ?? undefined,
        metadata: { gigflow_venue_id: invoice.venue_id },
      });
    }

    // Build description
    const parts = [];
    if (invoice.package_label) parts.push(invoice.package_label);
    if (invoice.event_date) parts.push(`Event: ${invoice.event_date}`);
    if (invoice.payment_type === "deposit") parts.push("(Deposit)");
    if (invoice.description) parts.push(invoice.description);
    const description = parts.join(" · ") || "Music Performance";

    // Create Stripe invoice
    const stripeInvoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: 7,
      metadata: { gigflow_invoice_id: id },
    });

    // Add line item
    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: stripeInvoice.id,
      amount: invoice.amount_cents,
      currency: "usd",
      description,
    });

    // Finalize and send
    await stripe.invoices.finalizeInvoice(stripeInvoice.id);
    const sentInvoice = await stripe.invoices.sendInvoice(stripeInvoice.id);

    // Update our record
    const { data: updated, error: updateError } = await supabase
      .from("invoices")
      .update({
        status: "sent",
        stripe_invoice_id: sentInvoice.id,
        stripe_invoice_url: sentInvoice.hosted_invoice_url,
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/tayloranderson/gigflow && npm run build 2>&1 | grep -i error | head -10
```

- [ ] **Step 5: Commit**

```bash
git add app/api/invoices/
git commit -m "feat: add invoice API routes"
```

---

## Task 6: Stripe webhook handler

**Files:**
- Create: `app/api/stripe/webhook/route.ts`

- [ ] **Step 1: Create webhook route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Must disable body parsing for webhook signature verification
export const config = { api: { bodyParser: false } };

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) return NextResponse.json({ error: "No signature" }, { status: 400 });

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === "invoice.paid") {
    const stripeInvoice = event.data.object as { id: string };
    const gigflowInvoiceId = (event.data.object as { metadata?: { gigflow_invoice_id?: string } }).metadata?.gigflow_invoice_id;

    if (gigflowInvoiceId) {
      const adminClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      await adminClient
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", gigflowInvoiceId);
    }
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 2: Set up webhook in Stripe dashboard**

1. Go to https://dashboard.stripe.com/test/webhooks
2. Click "Add endpoint"
3. Set URL to: `https://your-deployed-url/api/stripe/webhook` (for local testing use Stripe CLI)
4. Select event: `invoice.paid`
5. Copy the "Signing secret" and add it to `.env.local` as `STRIPE_WEBHOOK_SECRET`

- [ ] **Step 3: Commit**

```bash
git add app/api/stripe/
git commit -m "feat: add stripe webhook handler"
```

---

## Task 7: InvoiceStatusBadge component

**Files:**
- Create: `components/invoice/InvoiceStatusBadge.tsx`

- [ ] **Step 1: Create component**

```typescript
import { InvoiceStatus } from "@/types";

const STATUS_STYLES: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  draft:  { label: "Draft",  color: "#9a9591", bg: "rgba(154,149,145,0.15)" },
  sent:   { label: "Sent",   color: "#5b9bd5", bg: "rgba(91,155,213,0.15)"  },
  paid:   { label: "Paid",   color: "#4caf7d", bg: "rgba(76,175,125,0.15)"  },
  void:   { label: "Void",   color: "#e25c5c", bg: "rgba(226,92,92,0.15)"   },
};

export default function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      style={{
        backgroundColor: s.bg,
        color: s.color,
        fontSize: "10px",
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "99px",
      }}
    >
      {s.label}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/invoice/InvoiceStatusBadge.tsx
git commit -m "feat: add InvoiceStatusBadge component"
```

---

## Task 8: InvoiceModal component

**Files:**
- Create: `components/invoice/InvoiceModal.tsx`

- [ ] **Step 1: Create component**

```typescript
"use client";

import { useState } from "react";
import { Venue, Invoice, PaymentType } from "@/types";
import InvoiceStatusBadge from "./InvoiceStatusBadge";

interface Props {
  venue: Venue;
  onClose: () => void;
  onInvoiceCreated: (invoice: Invoice) => void;
}

const PACKAGES = ["Solo", "Trio", "Five Piece Band"];

export default function InvoiceModal({ venue, onClose, onInvoiceCreated }: Props) {
  const [step, setStep] = useState<"create" | "send" | "done">("create");
  const [invoice, setInvoice] = useState<Invoice | null>(null);

  // Create form state
  const [amountDollars, setAmountDollars] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("full");
  const [packageLabel, setPackageLabel] = useState(PACKAGES[0]);
  const [eventDate, setEventDate] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Send form state
  const [venueEmail, setVenueEmail] = useState(venue.contact_email ?? "");
  const [sending, setSending] = useState(false);

  async function handleCreate() {
    const cents = Math.round(parseFloat(amountDollars) * 100);
    if (!cents || isNaN(cents)) {
      setError("Please enter a valid amount");
      return;
    }
    setCreating(true);
    setError("");
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_id: venue.id,
        amount_cents: cents,
        payment_type: paymentType,
        event_date: eventDate || null,
        package_label: packageLabel,
        description: description || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to create invoice"); setCreating(false); return; }
    setInvoice(data);
    onInvoiceCreated(data);
    setStep("send");
    setCreating(false);
  }

  async function handleSend() {
    if (!invoice) return;
    if (!venueEmail.trim()) { setError("Please enter the venue's email address"); return; }
    setSending(true);
    setError("");
    const res = await fetch(`/api/invoices/${invoice.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venue_email: venueEmail, venue_name: venue.name }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to send invoice"); setSending(false); return; }
    setInvoice(data);
    setStep("done");
    setSending(false);
  }

  async function handleMarkPaid() {
    if (!invoice) return;
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paid" }),
    });
    const data = await res.json();
    if (res.ok) setInvoice(data);
  }

  const inputStyle = {
    backgroundColor: "#1e2128",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#f0ede8",
    borderRadius: "8px",
    padding: "8px 12px",
    fontSize: "13px",
    width: "100%",
    outline: "none",
  };

  const labelStyle = { color: "#5e5c58", fontSize: "10px", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: "6px", display: "block" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
      <div style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", width: "420px", maxWidth: "95vw" }}>

        {/* Header */}
        <div style={{ padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "#f0ede8", fontWeight: 600, fontSize: "14px" }}>
            {step === "create" ? "Create Invoice" : step === "send" ? "Send Invoice" : "Invoice Sent"}
          </div>
          <button onClick={onClose} style={{ color: "#5e5c58", fontSize: "20px", cursor: "pointer" }}>×</button>
        </div>

        <div style={{ padding: "20px" }}>

          {/* STEP: CREATE */}
          {step === "create" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={labelStyle}>Amount</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#9a9591" }}>$</span>
                  <input type="number" value={amountDollars} onChange={e => setAmountDollars(e.target.value)} placeholder="500.00" style={{ ...inputStyle, paddingLeft: "24px" }} />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Payment Type</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  {(["full", "deposit"] as PaymentType[]).map(t => (
                    <button key={t} onClick={() => setPaymentType(t)}
                      style={{ flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                        backgroundColor: paymentType === t ? "#d4a853" : "#1e2128",
                        color: paymentType === t ? "#0e0f11" : "#9a9591",
                        border: paymentType === t ? "none" : "1px solid rgba(255,255,255,0.1)" }}>
                      {t === "full" ? "Full Payment" : "Deposit"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={labelStyle}>Package</label>
                <select value={packageLabel} onChange={e => setPackageLabel(e.target.value)} style={inputStyle}>
                  {PACKAGES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Event Date (optional)</label>
                <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle}>Note (optional)</label>
                <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Friday happy hour, 6-9 PM" style={inputStyle} />
              </div>

              {error && <p style={{ color: "#e25c5c", fontSize: "12px" }}>{error}</p>}

              <button onClick={handleCreate} disabled={creating}
                style={{ backgroundColor: "#d4a853", color: "#0e0f11", borderRadius: "8px", padding: "10px", fontWeight: 700, fontSize: "13px", cursor: "pointer", opacity: creating ? 0.6 : 1 }}>
                {creating ? "Creating…" : "Create Invoice →"}
              </button>
            </div>
          )}

          {/* STEP: SEND */}
          {step === "send" && invoice && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ backgroundColor: "#1e2128", borderRadius: "10px", padding: "14px" }}>
                <div style={{ color: "#5e5c58", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>Invoice Summary</div>
                <div style={{ color: "#f0ede8", fontSize: "20px", fontWeight: 700 }}>${(invoice.amount_cents / 100).toFixed(2)}</div>
                <div style={{ color: "#9a9591", fontSize: "12px", marginTop: "4px" }}>
                  {invoice.package_label} · {invoice.payment_type === "deposit" ? "Deposit" : "Full Payment"}
                  {invoice.event_date ? ` · ${invoice.event_date}` : ""}
                </div>
              </div>

              <div>
                <label style={labelStyle}>Send to (venue email)</label>
                <input type="email" value={venueEmail} onChange={e => setVenueEmail(e.target.value)} placeholder="venue@example.com" style={inputStyle} />
              </div>

              {error && <p style={{ color: "#e25c5c", fontSize: "12px" }}>{error}</p>}

              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => { onInvoiceCreated(invoice); onClose(); }}
                  style={{ flex: 1, backgroundColor: "#1e2128", color: "#9a9591", borderRadius: "8px", padding: "10px", fontSize: "13px", cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)" }}>
                  Save as Draft
                </button>
                <button onClick={handleSend} disabled={sending}
                  style={{ flex: 2, backgroundColor: "#4a9d7a", color: "#fff", borderRadius: "8px", padding: "10px", fontWeight: 700, fontSize: "13px", cursor: "pointer", opacity: sending ? 0.6 : 1 }}>
                  {sending ? "Sending…" : "Send via Stripe →"}
                </button>
              </div>
            </div>
          )}

          {/* STEP: DONE */}
          {step === "done" && invoice && (
            <div style={{ textAlign: "center", padding: "10px 0" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>✉️</div>
              <div style={{ color: "#f0ede8", fontWeight: 600, fontSize: "14px", marginBottom: "6px" }}>Invoice sent!</div>
              <div style={{ color: "#9a9591", fontSize: "12px", marginBottom: "16px" }}>{venue.name} will receive it via email through Stripe.</div>

              <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                {invoice.stripe_invoice_url && (
                  <a href={invoice.stripe_invoice_url} target="_blank" rel="noopener noreferrer"
                    style={{ backgroundColor: "#1e2128", color: "#5b9bd5", borderRadius: "8px", padding: "8px 14px", fontSize: "12px", border: "1px solid rgba(255,255,255,0.1)" }}>
                    View Invoice ↗
                  </a>
                )}
                <button onClick={handleMarkPaid}
                  style={{ backgroundColor: invoice.status === "paid" ? "#4caf7d" : "#1e2128", color: invoice.status === "paid" ? "#fff" : "#9a9591", borderRadius: "8px", padding: "8px 14px", fontSize: "12px", cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {invoice.status === "paid" ? "✓ Marked Paid" : "Mark as Paid"}
                </button>
                <button onClick={onClose}
                  style={{ backgroundColor: "#d4a853", color: "#0e0f11", borderRadius: "8px", padding: "8px 14px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/invoice/
git commit -m "feat: add InvoiceModal component"
```

---

## Task 9: Wire invoice into VenueDetail

**Files:**
- Modify: `components/venue/VenueDetail.tsx`

- [ ] **Step 1: Add imports and state**

At the top of VenueDetail.tsx, add to the imports:
```typescript
import InvoiceModal from "@/components/invoice/InvoiceModal";
import InvoiceStatusBadge from "@/components/invoice/InvoiceStatusBadge";
import { Invoice } from "@/types";
```

Add to the component state (after `showEmailModal`):
```typescript
const [showInvoiceModal, setShowInvoiceModal] = useState(false);
const [invoices, setInvoices] = useState<Invoice[]>([]);
```

- [ ] **Step 2: Fetch invoices on load**

Add a useEffect to load invoices:
```typescript
useEffect(() => {
  fetch(`/api/invoices?venue_id=${venue.id}`)
    .then(r => r.json())
    .then(data => { if (Array.isArray(data)) setInvoices(data); });
}, [venue.id]);
```

- [ ] **Step 3: Add InvoiceModal to render**

After the PitchEmailModal block, add:
```typescript
{showInvoiceModal && (
  <InvoiceModal
    venue={venue}
    onClose={() => setShowInvoiceModal(false)}
    onInvoiceCreated={(inv) => {
      setInvoices(prev => [inv, ...prev.filter(i => i.id !== inv.id)]);
      setShowInvoiceModal(false);
    }}
  />
)}
```

- [ ] **Step 4: Add Invoice button in the interactions header**

In the `flex gap-2` div that contains the "Send Pitch Email" and "+ Log interaction" buttons, add:
```typescript
<button
  onClick={() => setShowInvoiceModal(true)}
  className="text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
  style={{ background: "#d4a853", color: "#0e0f11" }}
>
  Create Invoice
</button>
```

- [ ] **Step 5: Add invoice history list**

After the interactions list, add a section showing invoices:
```typescript
{invoices.length > 0 && (
  <div className="mt-8">
    <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#5e5c58" }}>Invoices</h2>
    <div className="space-y-2">
      {invoices.map(inv => (
        <div key={inv.id} className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: "#1e2128" }}>
          <div>
            <span style={{ color: "#f0ede8", fontSize: "13px", fontWeight: 500 }}>${(inv.amount_cents / 100).toFixed(2)}</span>
            <span style={{ color: "#5e5c58", fontSize: "11px", marginLeft: "8px" }}>{inv.package_label} · {inv.payment_type === "deposit" ? "Deposit" : "Full"}</span>
          </div>
          <div className="flex items-center gap-2">
            {inv.stripe_invoice_url && (
              <a href={inv.stripe_invoice_url} target="_blank" rel="noopener noreferrer" style={{ color: "#5b9bd5", fontSize: "11px" }}>View ↗</a>
            )}
            <InvoiceStatusBadge status={inv.status} />
          </div>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 6: Commit**

```bash
git add components/venue/VenueDetail.tsx
git commit -m "feat: wire invoices into venue detail page"
```

---

## Task 10: Update dashboard with invoice stats

**Files:**
- Modify: `app/(protected)/dashboard/page.tsx`

- [ ] **Step 1: Fetch unpaid invoices in dashboard**

After the existing `supabase.from("venues")` query, add:
```typescript
const { data: unpaidInvoices } = await supabase
  .from("invoices")
  .select("id, amount_cents, status")
  .eq("user_id", user.id)
  .in("status", ["sent", "draft"]);

const unpaidCount = unpaidInvoices?.length ?? 0;
const unpaidTotal = (unpaidInvoices ?? []).reduce((sum, inv) => sum + inv.amount_cents, 0);
```

- [ ] **Step 2: Add stat card**

Add a new card to the `statCards` array:
```typescript
{
  label: "Unpaid Invoices",
  value: unpaidCount,
  trend: `$${(unpaidTotal / 100).toFixed(0)} outstanding`,
  color: "#e09b50",
},
```

- [ ] **Step 3: Commit**

```bash
git add app/(protected)/dashboard/page.tsx
git commit -m "feat: add unpaid invoices stat to dashboard"
```

---

## Task 11: Final smoke test

- [ ] **Step 1: Start dev server**
```bash
cd /Users/tayloranderson/gigflow && npm run dev
```

- [ ] **Step 2: Test invoice creation**
1. Open http://localhost:3000/pipeline
2. Click any venue
3. Click "Create Invoice"
4. Fill in amount, package, date
5. Click "Create Invoice →"
6. Verify invoice appears in the list below

- [ ] **Step 3: Test send flow** (requires STRIPE_SECRET_KEY in .env.local)
1. Click "Send via Stripe →"
2. Enter a real email address
3. Check that email arrives from Stripe
4. Click "View Invoice ↗" — should open Stripe-hosted invoice

- [ ] **Step 4: Test manual paid**
1. On done screen, click "Mark as Paid"
2. Badge should turn green showing "Paid"

- [ ] **Step 5: Check dashboard**
1. Open http://localhost:3000/dashboard
2. Verify "Unpaid Invoices" stat card shows correct count

- [ ] **Step 6: Final commit**
```bash
git add -A
git commit -m "feat: stripe invoicing complete"
```
