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
      // Note: the bank-account list on the Account object (external_accounts)
      // and the listExternalAccounts() call are both built for Stripe Connect
      // platforms checking OTHER accounts' bank details — they're unreliable
      // (or outright blocked) when checking your own account. The fields
      // below are the ones Stripe documents as authoritative for your own
      // account's payout readiness.
      const account = await stripe.accounts.retrieve();
      report.account_id = account.id;
      report.charges_enabled = account.charges_enabled ? "✅ yes" : "❌ no — cannot accept payments yet";
      report.payouts_enabled = account.payouts_enabled ? "✅ yes — Stripe confirms a valid payout destination is on file" : "❌ no — Stripe is blocking payouts until setup is finished";
      report.details_submitted = account.details_submitted ? "✅ yes" : "❌ no — Stripe account setup is incomplete";

      if (account.requirements?.currently_due?.length) {
        report.action_needed = `⚠️ Stripe still needs: ${account.requirements.currently_due.join(", ")}`;
      } else if (account.payouts_enabled) {
        report.summary = "✅ Everything checks out — invoices you send can be paid and the money will reach your bank.";
      }
    } catch (e) {
      report.stripe_check_error = `Exception: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json(report, { status: 200 });
}
