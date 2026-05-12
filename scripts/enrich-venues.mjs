// Enrich all discovered venues with missing contact info
// Run with: node scripts/enrich-venues.mjs
//
// Search order per venue:
//   1. Google Places  → website, phone, address
//   2. Scrape website → follow contact-like links from homepage, then hardcoded paths
//   3. DuckDuckGo search → find the real/current website URL, then scrape that
//      (catches wrong/dead URLs in the DB and surfaces Yelp, directories, etc.)

import { createClient } from "@supabase/supabase-js";
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
const GOOGLE_KEY   = env["GOOGLE_PLACES_API_KEY"];

if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase credentials"); process.exit(1); }
if (!GOOGLE_KEY)                    { console.error("Missing GOOGLE_PLACES_API_KEY");  process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Filters ──────────────────────────────────────────────────────────────────
const SKIP_DOMAINS = [
  "example.com", "sentry.io", "w3.org", "schema.org",
  "twitter.com", "facebook.com", "instagram.com", "google.com", "apple.com",
  "yoursite.com", "youremail.com", "email.com", "domain.com",
  "wixpress.com", "squarespace.com", "mystore.com", "myshopify.com",
  "lunabeanmedia.com", "icewingcc.com",
  "bing.com", "microsoft.com", "yahoo.com", "yelp.com",
  "duckduckgo.com",
];
const SKIP_PREFIXES = [
  "noreply", "no-reply", "donotreply", "webmaster",
  "postmaster", "mailer-daemon", "bounce", "support@sentry", "user@", "hi@mystore",
];
const SKIP_DDG_HOSTS = /facebook|twitter|instagram|linkedin|yelp\.com|tripadvisor|google\.com|duckduckgo|squarespace|obtainwine/i;

// ── Helpers ──────────────────────────────────────────────────────────────────
function extractEmails(html) {
  const found = new Set();
  for (const m of html.matchAll(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi))
    found.add(m[1].toLowerCase());
  for (const m of html.matchAll(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g))
    found.add(m[1].toLowerCase());
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

function bestEmail(emails) {
  if (!emails.length) return null;
  return [...emails].sort((a, b) => scoreEmail(b) - scoreEmail(a))[0];
}

async function fetchPage(url, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.text()).slice(0, 250_000);
  } catch { return null; }
}

// Extract internal links that look like contact/booking pages
function extractContactLinks(html, base) {
  const keywords = /contact|about|book|hire|event|music|reach|touch|connect|entertain|privat/i;
  const links = new Set();
  for (const m of html.matchAll(/href=["']([^"'#?][^"']*?)["']/gi)) {
    const href = m[1].trim();
    if (!keywords.test(href)) continue;
    try {
      const abs = href.startsWith("http") ? new URL(href).href : new URL(href, base).href;
      if (abs.startsWith(base.replace(/\/$/, ""))) links.add(abs);
    } catch { /* skip */ }
  }
  return [...links].slice(0, 6);
}

// Step 2: Scrape a specific website URL
async function scrapeWebsite(siteUrl) {
  const base = siteUrl.replace(/\/$/, "");

  const homeHtml = await fetchPage(base);
  if (homeHtml) {
    const e = extractEmails(homeHtml);
    if (e.length) return bestEmail(e);

    // Follow contact-like links found on the homepage
    for (const url of extractContactLinks(homeHtml, base)) {
      const html = await fetchPage(url);
      if (!html) continue;
      const e2 = extractEmails(html);
      if (e2.length) return bestEmail(e2);
    }
  }

  // Hardcoded fallback paths
  for (const path of [
    "/contact", "/contact-us", "/about", "/booking", "/book",
    "/private-events", "/events", "/hire", "/live-music",
  ]) {
    const html = await fetchPage(`${base}${path}`);
    if (!html) continue;
    const e = extractEmails(html);
    if (e.length) return bestEmail(e);
  }

  return null;
}

// Step 3: DuckDuckGo search → find real website URLs → scrape them
async function searchDDGForEmail(name, city) {
  const q = `"${name}" ${city ?? ""} contact email`.trim();
  const ddgHtml = await fetchPage(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    12000
  );
  if (!ddgHtml) return null;

  // DDG HTML puts result URLs in elements with class="result__url"
  // They look like: <a class="result__url" ...>www.venue.com/contact</a>
  const resultUrls = [];
  for (const m of ddgHtml.matchAll(/class="result__url[^"]*"[^>]*>([^<]+)</g)) {
    const raw = m[1].trim().replace(/&amp;/g, "&");
    if (!raw) continue;
    try {
      const url = raw.startsWith("http") ? raw : `https://${raw}`;
      const host = new URL(url).hostname;
      if (SKIP_DDG_HOSTS.test(host)) continue;
      resultUrls.push(url);
    } catch { /* skip */ }
  }

  // Fetch each result URL and look for emails
  for (const url of resultUrls.slice(0, 5)) {
    const html = await fetchPage(url);
    if (!html) continue;
    const emails = extractEmails(html);
    if (emails.length) return bestEmail(emails);
  }

  return null;
}

// ── Enrich one venue ─────────────────────────────────────────────────────────
async function enrichVenue(venue) {
  const result = { email: null, website: null, phone: null, address: null };
  let siteUrl = venue.website || null;

  // Step 1: Google Places → website, phone, address
  try {
    const query = [venue.name, venue.city].filter(Boolean).join(", ");
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask": "places.formattedAddress,places.websiteUri,places.nationalPhoneNumber",
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
  } catch { /* continue */ }

  if (siteUrl) result.website = siteUrl;

  // Step 2: Scrape stored/found website
  if (siteUrl) {
    result.email = await scrapeWebsite(siteUrl);
  }

  // Step 3: DuckDuckGo search → find real URL → scrape
  if (!result.email) {
    result.email = await searchDDGForEmail(venue.name, venue.city);
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, city, type, website, address, contact_email, contact_phone, stage")
    .eq("stage", "discovered")
    .is("contact_email", null);

  if (error) { console.error("Supabase error:", error.message); process.exit(1); }
  if (!venues?.length) { console.log("No venues to enrich."); return; }

  console.log(`\nEnriching ${venues.length} discovered venues without emails...\n`);

  let updated = 0, skipped = 0;

  for (let i = 0; i < venues.length; i++) {
    const v = venues[i];
    process.stdout.write(`[${i + 1}/${venues.length}] ${v.name.padEnd(42)}`);

    const result = await enrichVenue(v);
    const patch  = {};
    if (result.email   && !v.contact_email)  patch.contact_email  = result.email;
    if (result.phone   && !v.contact_phone)  patch.contact_phone  = result.phone;
    if (result.website && !v.website)        patch.website        = result.website;
    if (result.address && !v.address)        patch.address        = result.address;

    if (Object.keys(patch).length > 0) {
      await supabase.from("venues").update(patch).eq("id", v.id);
      updated++;
      const found = Object.entries(patch).map(([k, val]) => {
        if (k === "contact_email") return `email: ${val}`;
        if (k === "contact_phone") return `phone: ${val}`;
        if (k === "website")       return `website: ${val}`;
        if (k === "address")       return "address";
        return k;
      });
      console.log(`✓  ${found.join("  |  ")}`);
    } else {
      skipped++;
      console.log("–  nothing found");
    }

    // Polite delay — be respectful to DDG
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log(`\nDone — ${updated} updated, ${skipped} skipped.\n`);
}

main().catch(console.error);
