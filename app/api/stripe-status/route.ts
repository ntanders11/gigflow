import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

// GET /api/stripe-status
// Returns a plain-language report of the Stripe configuration —
// specifically whether the connected account can actually receive payouts.
// Requires login — only for the account owner to debug.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const secretKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();

  const report: Record<string, string> = {
    STRIPE_SECRET_KEY: secretKey ? `✅ set (${secretKey.startsWith("sk_live") ? "LIVE mode" : secretKey.startsWith("sk_test") ? "TEST mode" : "unknown format"})` : "❌ NOT SET — invoices cannot be created",
    STRIPE_WEBHOOK_SECRET: webhookSecret ? "✅ set" : "❌ NOT SET — invoices won't auto-mark as paid",
  };

  if (secretKey) {
    try {
      const account = await stripe.accounts.retrieve({ expand: ["external_accounts"] });
      report.account_id = account.id;
      report.bank_account_connected = account.external_accounts?.data?.length
        ? `✅ yes (${account.external_accounts.data.length} on file)`
        : "❌ no bank account on file — payments have nowhere to deposit";
      report.charges_enabled = account.charges_enabled ? "✅ yes" : "❌ no — cannot accept payments yet";
      report.payouts_enabled = account.payouts_enabled ? "✅ yes — money will reach your bank" : "❌ no — Stripe is blocking payouts until setup is finished";
      report.details_submitted = account.details_submitted ? "✅ yes" : "❌ no — Stripe account setup is incomplete";

      if (account.requirements?.currently_due?.length) {
        report.action_needed = `⚠️ Stripe still needs: ${account.requirements.currently_due.join(", ")}`;
      }
    } catch (e) {
      report.stripe_check_error = `Exception: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json(report, { status: 200 });
}
