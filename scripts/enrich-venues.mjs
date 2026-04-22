// One-time script to enrich all discovered venues with missing contact info
// Run with: node scripts/enrich-venues.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("=").map((p, i) => i === 0 ? p.trim() : l.slice(l.indexOf("=") + 1).trim()))
    .filter(([k]) => k)
);

const SUPABASE_URL     = env["NEXT_PUBLIC_SUPABASE_URL"];
const SERVICE_KEY      = env["SUPABASE_SERVICE_ROLE_KEY"];
const GOOGLE_KEY       = env["GOOGLE_PLACES_API_KEY"];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}
if (!GOOGLE_KEY) {
  console.error("Missing GOOGLE_PLACES_API_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SKIP_DOMAINS   = ["example.com","sentry.io","w3.org","schema.org","twitter.com","facebook.com","instagram.com","google.com","apple.com"];
const SKIP_PREFIXES  = ["noreply","no-reply","donotreply","webmaster","postmaster","mailer-daemon","bounce"];

function extractEmails(html) {
  const found = new Set();
  const mailtoRe = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  const emailRe  = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  let m;
  while ((m = mailtoRe.exec(html)) !== null) found.add(m[1].toLowerCase());
  while ((m = emailRe.exec(html)) !== null)  found.add(m[1].toLowerCase());
  return [...found].filter((email) => {
    const [local, domain] = email.split("@");
    if (!domain) return false;
    if (SKIP_DOMAINS.some((d) => domain.includes(d))) return false;
    if (SKIP_PREFIXES.some((p) => local.startsWith(p))) return false;
    if (/\.(png|jpg|gif|svg|css|js|php|html)$/i.test(domain)) return false;
    return true;
  });
}

function scoreEmail(email) {
  const local = email.split("@")[0];
  if (/book|event|gig|music|live|perform|entertain/i.test(local)) return 3;
  if (/contact|info|hello|hi|inquir|general/i.test(local)) return 2;
  if (/manager|owner|admin|reserv/i.test(local)) return 1;
  return 0;
}

async function fetchPage(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GigFlow/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 200_000);
  } catch { return null; }
}

async function enrichVenue(venue) {
  const result = { email: null, website: null, phone: null, address: null };
  let siteUrl = venue.website || null;

  // Google Places
  try {
    const query = [venue.name, venue.city].filter(Boolean).join(", ");
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask": "places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.types",
      },
      body: JSON.stringify({ textQuery: query, includedType: "establishment" }),
    });
    if (res.ok) {
      const data = await res.json();
      for (const place of data?.places ?? []) {
        const addr = place?.formattedAddress ?? "";
        if (/^\d/.test(addr.trim()) && !venue.address) result.address = addr;
        if (place?.websiteUri && !siteUrl) siteUrl = place.websiteUri;
        if (place?.nationalPhoneNumber && !venue.contact_phone) result.phone = place.nationalPhoneNumber;
        if (result.address || siteUrl) break;
      }
    }
  } catch (e) { /* continue */ }

  if (siteUrl) result.website = siteUrl;

  // Scrape for email
  if (siteUrl) {
    const base = siteUrl.replace(/\/$/, "");
    const pages = [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`, `${base}/booking`];
    for (const url of pages) {
      const html = await fetchPage(url);
      if (!html) continue;
      const emails = extractEmails(html);
      if (emails.length > 0) {
        emails.sort((a, b) => scoreEmail(b) - scoreEmail(a));
        result.email = emails[0];
        break;
      }
    }
  }

  return result;
}

async function main() {
  // Fetch all discovered venues missing a contact email
  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, city, type, website, address, contact_email, contact_phone, stage")
    .eq("stage", "discovered")
    .is("contact_email", null);

  if (error) { console.error("Supabase error:", error.message); process.exit(1); }
  if (!venues || venues.length === 0) { console.log("No venues to enrich."); return; }

  console.log(`\nEnriching ${venues.length} discovered venues without emails...\n`);

  let updated = 0, skipped = 0;

  for (let i = 0; i < venues.length; i++) {
    const v = venues[i];
    process.stdout.write(`[${i + 1}/${venues.length}] ${v.name.padEnd(40)}`);

    const result = await enrichVenue(v);
    const patch = {};
    if (result.email && !v.contact_email)     patch.contact_email  = result.email;
    if (result.phone && !v.contact_phone)     patch.contact_phone  = result.phone;
    if (result.website && !v.website)         patch.website        = result.website;
    if (result.address && !v.address)         patch.address        = result.address;

    if (Object.keys(patch).length > 0) {
      await supabase.from("venues").update(patch).eq("id", v.id);
      updated++;
      const found = Object.entries(patch).map(([k, val]) => {
        if (k === "contact_email") return `email: ${val}`;
        if (k === "contact_phone") return `phone: ${val}`;
        if (k === "website")       return `website: ${val}`;
        if (k === "address")       return `address`;
        return k;
      });
      console.log(`✓  ${found.join("  |  ")}`);
    } else {
      skipped++;
      console.log("–  nothing found");
    }

    // Polite delay
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nDone — ${updated} updated, ${skipped} skipped.\n`);
}

main().catch(console.error);
