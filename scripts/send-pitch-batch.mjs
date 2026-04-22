// Send initial pitch emails to discovered venues that now have contact emails
// Run with: node scripts/send-pitch-batch.mjs
//
// Targets: stage = "discovered", contact_email IS NOT NULL, never contacted before

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

const SUPABASE_URL  = env["NEXT_PUBLIC_SUPABASE_URL"];
const SERVICE_KEY   = env["SUPABASE_SERVICE_ROLE_KEY"];
const RESEND_KEY    = env["RESEND_API_KEY"];
const FROM_EMAIL    = env["RESEND_FROM_EMAIL"];

if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase credentials"); process.exit(1); }
if (!RESEND_KEY)                    { console.error("Missing RESEND_API_KEY");        process.exit(1); }
if (!FROM_EMAIL)                    { console.error("Missing RESEND_FROM_EMAIL");     process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const resend   = new Resend(RESEND_KEY);

// ── Email template (matches PitchEmailModal buildBody / buildSubject) ────────
function buildSubject(venueName) {
  return `Live music inquiry for ${venueName} — full-band sound, one performer`;
}

function buildBody(venueName, profile, contactName) {
  const greeting = contactName ? `Hi ${contactName},` : `Hi there,`;
  const name    = profile?.display_name ?? "Taylor Anderson";
  const phone   = profile?.phone        ?? "(503) 997-3586";
  const website = profile?.social_links?.website ?? "taylorandersonmusic.com";
  const youtube = profile?.social_links?.youtube
    ?? profile?.video_samples?.[0]?.url
    ?? "https://youtu.be/JaPOuz1R0HI?si=lo5JhEbgowL2g5JU";
  const bio = profile?.bio?.trim()
    ? profile.bio.trim()
    : `For over a decade, I ran my own music business — booking and performing at resorts, wineries, and venues throughout the Scottsdale and Phoenix area. What makes my show unique: using a live looper, I build guitar, bass, keys, and drums on the spot — a full-band sound with just one performer. My sets blend Top 40, '60s–'00s classics, and a touch of country.`;

  return `${greeting}

I'm ${name} — a full-time musician with over a decade of live performance experience. I recently relocated to the Newberg area and would love to play at ${venueName}.

${bio}

Hear it for yourself: ${youtube}

I'm booking upcoming dates now and would love to find a time that works for ${venueName}. Would you be open to a quick call this week?

Thanks so much,
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
  // 1. Fetch discovered venues that have an email but have never been contacted
  const { data: venues, error: venueErr } = await supabase
    .from("venues")
    .select("id, user_id, name, city, contact_email, contact_name, stage, last_contacted_at")
    .eq("stage", "discovered")
    .not("contact_email", "is", null)
    .is("last_contacted_at", null);

  if (venueErr) { console.error("Supabase error:", venueErr.message); process.exit(1); }
  if (!venues || venues.length === 0) {
    console.log("No venues to email — none are in 'discovered' stage with an email and no prior contact.");
    return;
  }

  // 2. Fetch artist profile (use first venue's user_id)
  const user_id = venues[0].user_id;
  const { data: profile } = await supabase
    .from("artist_profiles")
    .select("*")
    .eq("user_id", user_id)
    .single();

  console.log(`\nSending pitch emails to ${venues.length} venue${venues.length !== 1 ? "s" : ""}...\n`);

  let sent = 0, failed = 0;

  for (let i = 0; i < venues.length; i++) {
    const v = venues[i];
    const label = `[${i + 1}/${venues.length}] ${v.name.padEnd(40)}`;
    process.stdout.write(label);

    const subject  = buildSubject(v.name);
    const bodyText = buildBody(v.name, profile, v.contact_name);
    const bodyHtml = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${bodyToHtml(bodyText)}</div>`;

    try {
      // Send the email
      const { data: sendData, error: sendErr } = await resend.emails.send({
        from: FROM_EMAIL,
        to:   v.contact_email,
        subject,
        text: bodyText,
        html: bodyHtml,
      });

      if (sendErr) throw new Error(sendErr.message);

      const now = new Date().toISOString();

      // Log interaction
      await supabase.from("interactions").insert({
        venue_id:      v.id,
        user_id:       v.user_id,
        type:          "email",
        email_subject: subject,
        email_body:    bodyText,
        email_sent:    true,
        resend_id:     sendData?.id ?? null,
        occurred_at:   now,
      });

      // Update venue: mark contacted and advance stage
      await supabase
        .from("venues")
        .update({ last_contacted_at: now, stage: "contacted" })
        .eq("id", v.id);

      console.log(`✓  → ${v.contact_email}`);
      sent++;
    } catch (err) {
      console.log(`✗  FAILED: ${err.message}`);
      failed++;
    }

    // Small delay to be polite to Resend rate limits
    if (i < venues.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\nDone — ${sent} sent, ${failed} failed.\n`);
}

main().catch(console.error);
