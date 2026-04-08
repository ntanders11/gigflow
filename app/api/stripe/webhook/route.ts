import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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

  if (event.type === "invoice.paid" || event.type === "invoice_payment.paid") {
    const stripeInvoiceObj = event.data.object as { metadata?: { gigflow_invoice_id?: string }; invoice?: string };
    // invoice_payment.paid nests the invoice ID differently
    const gigflowInvoiceId = stripeInvoiceObj.metadata?.gigflow_invoice_id;

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
