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
    // invoice.paid: event.data.object IS the Invoice, so its own id is the
    // Stripe invoice id. invoice_payment.paid: event.data.object is an
    // "Invoice Payment" object — a different shape that does NOT carry the
    // invoice's metadata, only a plain `invoice` field pointing at it by id.
    // Matching on stripe_invoice_id (which we already store at creation
    // time, in app/api/invoices/[id]/send/route.ts) works for both shapes
    // without relying on metadata surviving the trip at all — discovered
    // 2026-09-25 after a real paid invoice never flipped to "paid" because
    // this previously read `.metadata.gigflow_invoice_id` off the payment
    // object, which doesn't exist there.
    const obj = event.data.object as { id?: string; invoice?: string };
    const stripeInvoiceId = event.type === "invoice.paid" ? obj.id : obj.invoice;

    if (stripeInvoiceId) {
      const adminClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      await adminClient
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("stripe_invoice_id", stripeInvoiceId);
    }
  }

  return NextResponse.json({ received: true });
}
