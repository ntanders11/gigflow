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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { venue_email, venue_name } = body;

  if (!venue_email) {
    return NextResponse.json({ error: "venue_email is required" }, { status: 400 });
  }

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
    const existingCustomers = await stripe.customers.list({ email: venue_email, limit: 1 });
    let customer = existingCustomers.data[0];
    if (!customer) {
      customer = await stripe.customers.create({
        email: venue_email,
        name: venue_name ?? undefined,
        metadata: { gigflow_venue_id: invoice.venue_id },
      });
    }

    const parts = [];
    if (invoice.package_label) parts.push(invoice.package_label);
    if (invoice.event_date) parts.push(`Event: ${invoice.event_date}`);
    if (invoice.payment_type === "deposit") parts.push("(Deposit)");
    if (invoice.description) parts.push(invoice.description);
    const description = parts.join(" · ") || "Music Performance";

    const stripeInvoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: 7,
      metadata: { gigflow_invoice_id: id },
    });

    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: stripeInvoice.id,
      amount: invoice.amount_cents,
      currency: "usd",
      description,
    });

    await stripe.invoices.finalizeInvoice(stripeInvoice.id);
    const sentInvoice = await stripe.invoices.sendInvoice(stripeInvoice.id);

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
