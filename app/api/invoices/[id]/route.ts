import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

// PATCH /api/invoices/[id] — manually mark as paid or void
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

// DELETE /api/invoices/[id] — remove an invoice
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: invoice, error: loadError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (loadError || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // If it was sent through Stripe and hasn't been paid yet, void it there too
  // so the venue can't pay a link we've removed from GigFlow. If Stripe
  // rejects the void (e.g. it's already paid or already void), that's fine —
  // we still remove it from GigFlow's records below.
  if (invoice.stripe_invoice_id && invoice.status === "sent") {
    try {
      await stripe.invoices.voidInvoice(invoice.stripe_invoice_id);
    } catch {
      // non-fatal
    }
  }

  const { error } = await supabase
    .from("invoices")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
