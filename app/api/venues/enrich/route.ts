import { NextRequest, NextResponse } from "next/server";

const SKIP_DOMAINS = ["example.com", "sentry.io", "w3.org", "schema.org",
  "twitter.com", "facebook.com", "instagram.com", "google.com", "apple.com",
  "yoursite.com", "youremail.com", "email.com", "domain.com"];

const SKIP_PREFIXES = ["noreply", "no-reply", "donotreply", "webmaster",
  "postmaster", "mailer-daemon", "bounce", "support@sentry"];

function extractEmails(html: string): string[] {
  const found = new Set<string>();

  // mailto: links first (most reliable)
  const mailtoRe = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html)) !== null) found.add(m[1].toLowerCase());

  // Plain email pattern in text
  const emailRe = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  while ((m = emailRe.exec(html)) !== null) found.add(m[1].toLowerCase());

  return [...found].filter((email) => {
    const [local, domain] = email.split("@");
    if (!domain) return false;
    if (SKIP_DOMAINS.some((d) => domain.includes(d))) return false;
    if (SKIP_PREFIXES.some((p) => local.startsWith(p))) return false;
    if (/\.(png|jpg|gif|svg|css|js|php|html)$/i.test(domain)) return false;
    return true;
  });
}

// Score emails — booking/contact addresses rank higher
function scoreEmail(email: string): number {
  const local = email.split("@")[0];
  if (/book|event|gig|music|live|perform|entertain/i.test(local)) return 3;
  if (/contact|info|hello|hi|inquir|general/i.test(local)) return 2;
  if (/manager|owner|admin|reserv/i.test(local)) return 1;
  return 0;
}

async function fetchPage(url: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GigFlow/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 200_000); // cap at 200kb
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const name    = req.nextUrl.searchParams.get("name");
  const city    = req.nextUrl.searchParams.get("city");
  const website = req.nextUrl.searchParams.get("website"); // existing website if known

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

  // ── Step 2: Scrape website for email ─────────────────────────────────────
  if (siteUrl) {
    const base = siteUrl.replace(/\/$/, "");
    const pagesToTry = [
      base,
      `${base}/contact`,
      `${base}/contact-us`,
      `${base}/about`,
      `${base}/booking`,
      `${base}/book`,
    ];

    for (const url of pagesToTry) {
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

  return NextResponse.json(result);
}
