import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";

// GET /api/email-status
// Returns a plain-language report of the email configuration.
// Requires login — only for the account owner to debug.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey    = (process.env.RESEND_API_KEY    ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();

  const report: Record<string, string> = {
    RESEND_API_KEY:    apiKey    ? `✅ set (ends in …${apiKey.slice(-4)})`    : "❌ NOT SET — emails cannot send",
    RESEND_FROM_EMAIL: fromEmail ? `✅ ${fromEmail}`                          : "❌ NOT SET — emails cannot send",
  };

  // If we have a key, try to list domains from Resend to verify the key is valid
  if (apiKey) {
    try {
      const resend = new Resend(apiKey);
      const { data, error } = await resend.domains.list();
      if (error) {
        report.resend_api_key_valid = `❌ Key rejected by Resend: ${error.message}`;
      } else {
        const domains = data?.data ?? [];
        const verified = domains.filter((d) => d.status === "verified").map((d) => d.name);
        const pending  = domains.filter((d) => d.status !== "verified").map((d) => `${d.name} (${d.status})`);
        report.resend_key_valid    = "✅ API key accepted by Resend";
        report.verified_domains    = verified.length   ? verified.join(", ") : "⚠️ none — emails can only go to the Resend account owner";
        report.unverified_domains  = pending.length    ? pending.join(", ")  : "none";

        // Check if the from domain is verified
        const fromDomain = fromEmail.split("@")[1] ?? "";
        const domainOk   = verified.some((d) => fromDomain.endsWith(d));
        report.from_domain_status = domainOk
          ? `✅ ${fromDomain} is verified — emails will deliver to anyone`
          : `❌ ${fromDomain} is NOT in verified domains — emails only go to the Resend account owner's inbox`;
      }
    } catch (e) {
      report.resend_check_error = `Exception: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json(report, { status: 200 });
}
