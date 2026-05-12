import { NextRequest, NextResponse } from "next/server";

const SKIP_DOMAINS = [
  "example.com", "sentry.io", "w3.org", "schema.org",
  "twitter.com", "facebook.com", "instagram.com", "google.com", "apple.com",
  "yoursite.com", "youremail.com", "email.com", "domain.com",
  "wixpress.com", "squarespace.com", "mystore.com", "myshopify.com",
  "lunabeanmedia.com", "icewingcc.com",
  "bing.com", "microsoft.com", "yahoo.com", "yelp.com",
];

const SKIP_PREFIXES = [
  "noreply", "no-reply", "donotreply", "webmaster",
  "postmaster", "mailer-daemon", "bounce", "support@sentry", "user@", "hi@mystore",
];

function extractEmails(html: string): string[] {
  const found = new Set<string>();
  const mailtoRe = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  const emailRe  = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html)) !== null) found.add(m[1].toLowerCase());
  while ((m = emailRe.exec(html))   !== null) found.add(m[1].toLowerCase());

  return [...found].filter((email) => {
    const [local, domain] = email.split("@");
    if (!domain) return false;
    if (SKIP_DOMAINS.some((d) => domain.includes(d))) return false;
    if (SKIP_PREFIXES.some((p) => local.startsWith(p))) return false;
    if (/\.(png|jpg|gif|svg|css|js|php|html)$/i.test(domain)) return false;
    return true;
  });
}

function scoreEmail(email: string): number {
  const local = email.split("@")[0];
  if (/book|event|gig|music|live|perform|entertain/i.test(local)) return 3;
  if (/contact|info|hello|hi|inquir|general/i.test(local)) return 2;
  if (/manager|owner|admin|reserv/i.test(local)) return 1;
  return 0;
}

async function fetchPage(url: string, timeoutMs = 7000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 200_000);
  } catch {
    return null;
  }
}

// Extract internal links that look like contact/booking pages
function extractContactLinks(html: string, base: string): string[] {
  const keywords = /contact|about|book|hire|event|music|reach|touch|connect|entertain|privat/i;
  const linkRe   = /href=["']([^"'#?][^"']*?)["']/gi;
  const links    = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1].trim();
    if (!keywords.test(href)) continue;
    try {
      const abs = href.startsWith("http")
        ? new URL(href).href
        : new URL(href, base).href;
      // Only follow same-origin links
      if (abs.startsWith(base.replace(/\/$/, ""))) links.add(abs);
    } catch { /* skip malformed */ }
  }
  return [...links].slice(0, 6);
}

// Scrape the venue website — homepage first, then contact-like links, then hardcoded fallbacks
async function scrapeWebsiteForEmail(siteUrl: string): Promise<string | null> {
  const base = siteUrl.replace(/\/$/, "");

  // 1. Fetch homepage
  const homeHtml = await fetchPage(base);
  if (homeHtml) {
    const emails = extractEmails(homeHtml);
    if (emails.length) {
      emails.sort((a, b) => scoreEmail(b) - scoreEmail(a));
      return emails[0];
    }

    // 2. Follow contact-like links found on homepage
    const contactLinks = extractContactLinks(homeHtml, base);
    for (const url of contactLinks) {
      const html = await fetchPage(url);
      if (!html) continue;
      const emails = extractEmails(html);
      if (emails.length) {
        emails.sort((a, b) => scoreEmail(b) - scoreEmail(a));
        return emails[0];
      }
    }
  }

  // 3. Hardcoded fallback paths
  const fallbacks = [
    `${base}/contact`, `${base}/contact-us`, `${base}/about`,
    `${base}/booking`, `${base}/book`, `${base}/private-events`,
    `${base}/events`, `${base}/hire`, `${base}/live-music`,
  ];
  for (const url of fallbacks) {
    const html = await fetchPage(url);
    if (!html) continue;
    const emails = extractEmails(html);
    if (emails.length) {
      emails.sort((a, b) => scoreEmail(b) - scoreEmail(a));
      return emails[0];
    }
  }

  return null;
}

// Search Bing for "[venue name] [city] email contact" and extract emails from results
async function searchBingForEmail(name: string, city: string | null): Promise<string | null> {
  const q    = `"${name}" ${city ?? ""} email contact`.trim();
  const url  = `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=5`;
  const html = await fetchPage(url, 8000);
  if (!html) return null;

  const emails = extractEmails(html);
  if (!emails.length) return null;
  emails.sort((a, b) => scoreEmail(b) - scoreEmail(a));
  return emails[0];
}

export async function GET(req: NextRequest) {
  const name    = req.nextUrl.searchParams.get("name");
  const city    = req.nextUrl.searchParams.get("city");
  const website = req.nextUrl.searchParams.get("website");

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const result: {
    email: string | null;
    website: string | null;
    phone: string | null;
    address: string | null;
  } = { email: null, website: null, phone: null, address: null };

  // ── Step 1: Google Places for website / phone / address ───────────────────
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  let siteUrl = website || null;

  if (googleKey) {
    try {
      const query = [name, city].filter(Boolean).join(", ");
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": googleKey,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.types",
        },
        body: JSON.stringify({ textQuery: query, includedType: "establishment" }),
      });
      if (res.ok) {
        const data = await res.json();
        for (const place of data?.places ?? []) {
          const addr: string = place?.formattedAddress ?? "";
          if (/^\d/.test(addr.trim())) result.address = addr;
          if (place?.websiteUri && !siteUrl) siteUrl = place.websiteUri;
          if (place?.nationalPhoneNumber) result.phone = place.nationalPhoneNumber;
          if (result.address) break;
        }
      }
    } catch { /* continue */ }
  }

  if (siteUrl) result.website = siteUrl;

  // ── Step 2: Scrape venue website (with link-following) ────────────────────
  if (siteUrl) {
    result.email = await scrapeWebsiteForEmail(siteUrl);
  }

  // ── Step 3: Bing search fallback ──────────────────────────────────────────
  if (!result.email) {
    result.email = await searchBingForEmail(name, city);
  }

  return NextResponse.json(result);
}
