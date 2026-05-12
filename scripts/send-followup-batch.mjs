// Send follow-up emails to all contacted venues that haven't replied
// Run with: node scripts/send-followup-batch.mjs

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => [l.split("=")[0].trim(), l.slice(l.indexOf("=") + 1).trim()])
    .filter(([k]) => k)
);

const SUPABASE_URL = env["NEXT_PUBLIC_SUPABASE_URL"];
const SERVICE_KEY  = env["SUPABASE_SERVICE_ROLE_KEY"];
const RESEND_KEY   = env["RESEND_API_KEY"];
const FROM_EMAIL   = env["RESEND_FROM_EMAIL"];

if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase credentials"); process.exit(1); }
if (!RESEND_KEY)                    { console.error("Missing RESEND_API_KEY");        process.exit(1); }
if (!FROM_EMAIL)                    { console.error("Missing RESEND_FROM_EMAIL");     process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const resend   = new Resend(RESEND_KEY);

// ── Follow-up email template (matches PitchEmailModal buildFollowUpBody) ────
function buildSubject(venueName) {
  return `Following up — live music inquiry for ${venueName}`;
}

function buildBody(venueName, profile, contactName) {
  const greeting = contactName ? `Hi ${contactName},` : `Hi there,`;
  const name    = profile?.display_name ?? "Taylor Anderson";
  const phone   = profile?.phone        ?? "(503) 997-3586";
  const website = profile?.social_links?.website ?? "taylorandersonmusic.com";
  const youtube = profile?.social_links?.youtube
    ?? profile?.video_samples?.[0]?.url
    ?? "https://youtu.be/JaPOuz1R0HI?si=lo5JhEbgowL2g5JU";

  return `${greeting}

I wanted to follow up on my email from a few weeks ago about playing at ${venueName}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.

Hear it for yourself: ${youtube}

Happy to work around your schedule. Thanks for your time!

${name}
${phone}
${website}`;
}

function bodyToHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /(Hear it for yourself): (https?:\/\/[^\s]+)/g,
      '<a href="$2" style="color:#4a9d7a;">$1</a>'
    )
    .replace(/\n/g, "<br>");
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Fetch all contacted venues with an email
  const { data: venues, error: venueErr } = await supabase
    .from("venues")
    .select("id, user_id, name, city, contact_email, contact_name, stage, last_contacted_at")
    .eq("stage", "contacted")
    .not("contact_email", "is", null)
    .order("last_contacted_at", { ascending: true });

  if (venueErr) { console.error("Supabase error:", venueErr.message); process.exit(1); }
  if (!venues || venues.length === 0) {
    console.log("No contacted venues with emails found.");
    return;
  }

  // Fetch artist profile
  const user_id = venues[0].user_id;
  const { data: profile } = await supabase
    .from("artist_profiles")
    .select("*")
    .eq("user_id", user_id)
    .single();

  console.log(`\nSending follow-up emails to ${venues.length} venue${venues.length !== 1 ? "s" : ""}...\n`);

  let sent = 0, failed = 0;

  for (let i = 0; i < venues.length; i++) {
    const v = venues[i];
    const days = v.last_contacted_at
      ? Math.floor((Date.now() - new Date(v.last_contacted_at).getTime()) / 86400000)
      : "?";
    const label = `[${i + 1}/${venues.length}] ${v.name.padEnd(42)} (${days}d ago)`;
    process.stdout.write(label + "  ");

    const subject  = buildSubject(v.name);
    const bodyText = buildBody(v.name, profile, v.contact_name);
    const bodyHtml = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${bodyToHtml(bodyText)}</div>`;

    try {
      const { data: sendData, error: sendErr } = await resend.emails.send({
        from: FROM_EMAIL,
        to:   v.contact_email,
        subject,
        text: bodyText,
        html: bodyHtml,
      });

      if (sendErr) throw new Error(sendErr.message);

      const now = new Date().toISOString();

      // Log as a follow_up interaction
      await supabase.from("interactions").insert({
        venue_id:      v.id,
        user_id:       v.user_id,
        type:          "follow_up",
        email_subject: subject,
        email_body:    bodyText,
        email_sent:    true,
        resend_id:     sendData?.id ?? null,
        occurred_at:   now,
      });

      // Update last_contacted_at
      await supabase
        .from("venues")
        .update({ last_contacted_at: now })
        .eq("id", v.id);

      console.log(`✓  → ${v.contact_email}`);
      sent++;
    } catch (err) {
      console.log(`✗  FAILED: ${err.message}`);
      failed++;
    }

    if (i < venues.length - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  console.log(`\nDone — ${sent} sent, ${failed} failed.\n`);
}

main().catch(console.error);
