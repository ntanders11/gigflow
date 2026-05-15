"""
Fill missing contact_email fields by:
  1. Scraping the venue's website one more time (catches pages missed before)
  2. Guessing pattern emails: booking@domain, info@domain, etc.
  3. For venues without a website, guessing the domain from the venue name

Run with: python3 scripts/guess-emails.py
"""

import re
import socket
import time
from pathlib import Path
from supabase import create_client
import urllib.request
import urllib.error

# ── Load .env.local ──────────────────────────────────────────────────────────
env = {}
for line in (Path(__file__).parent.parent / ".env.local").read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    k, _, v = line.partition("=")
    env[k.strip()] = v.strip()

supabase = create_client(env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

# ── Email config ─────────────────────────────────────────────────────────────
# Prefixes tried in priority order
BOOKING_PREFIXES   = ["booking", "bookings", "music", "live", "events",
                       "entertainment", "livemusic", "gigs"]
CONTACT_PREFIXES   = ["info", "contact", "hello", "hi", "general", "inquiries"]
ALL_PREFIXES       = BOOKING_PREFIXES + CONTACT_PREFIXES

# Email pattern found on page — pull it out (reuse enrich logic)
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
SKIP_DOMAINS = {
    "example.com", "sentry.io", "w3.org", "schema.org",
    "twitter.com", "facebook.com", "instagram.com", "google.com", "apple.com",
    "yoursite.com", "youremail.com", "email.com", "domain.com",
    "wixpress.com", "squarespace.com", "mystore.com", "myshopify.com",
    "lunabeanmedia.com", "icewingcc.com", "bing.com", "microsoft.com",
    "yahoo.com", "yelp.com", "duckduckgo.com",
}
SKIP_PREFIXES = [
    "noreply", "no-reply", "donotreply", "webmaster", "postmaster",
    "mailer-daemon", "bounce", "support@sentry", "user@", "hi@mystore",
]

def valid_email(email):
    local, _, domain = email.partition("@")
    if not domain:
        return False
    if any(bad in domain.lower() for bad in SKIP_DOMAINS):
        return False
    if any(local.lower().startswith(p) for p in SKIP_PREFIXES):
        return False
    if re.search(r"\.(png|jpg|gif|svg|css|js|php|html)$", domain, re.I):
        return False
    return True

def score_email(email):
    local = email.split("@")[0].lower()
    if re.search(r"book|event|gig|music|live|perform|entertain", local): return 3
    if re.search(r"contact|info|hello|hi|inquir|general", local):        return 2
    if re.search(r"manager|owner|admin|reserv",            local):        return 1
    return 0

def best_from(emails):
    valid = [e for e in emails if valid_email(e)]
    if not valid:
        return None
    return sorted(valid, key=score_email, reverse=True)[0]

# ── Domain helpers ───────────────────────────────────────────────────────────
def domain_from_url(url):
    """Strip protocol/path, return bare hostname without www."""
    url = re.sub(r"^https?://", "", url).split("/")[0].split("?")[0].lower()
    return url[4:] if url.startswith("www.") else url

def guess_domain_from_name(name):
    """Best-effort domain guess from a venue name."""
    clean = name.lower()
    # Remove possessives, punctuation
    clean = re.sub(r"'s|'s", "", clean)
    clean = re.sub(r"[^a-z0-9\s]", "", clean)
    # Drop very common filler words that rarely appear in domains
    stop = {" the ", " a ", " an ", " and ", " or ", " of ", " at ",
            " bar ", " grill ", " pub ", " tavern ", " lounge ",
            " winery ", " vineyard ", " brewing ", " brewery ",
            " saloon ", " cafe ", " restaurant "}
    for w in stop:
        clean = clean.replace(w, " ")
    clean = clean.strip().replace(" ", "")
    return f"{clean}.com" if clean else None

def domain_resolves(domain):
    """Return True if the domain has a DNS A record."""
    try:
        socket.getaddrinfo(domain, 80, socket.AF_INET)
        return True
    except Exception:
        return False

# ── Web fetch (reuse approach from enrich script) ────────────────────────────
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

def fetch(url, timeout=8):
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read(250_000).decode("utf-8", errors="ignore")
    except Exception:
        return None

def scrape_for_email(base_url):
    """
    Quick re-scrape: home page + /contact + /about + /booking.
    Returns best email found, or None.
    """
    base = base_url.rstrip("/")
    pages = [base, f"{base}/contact", f"{base}/contact-us",
             f"{base}/about", f"{base}/booking", f"{base}/book",
             f"{base}/private-events", f"{base}/live-music"]
    for url in pages:
        html = fetch(url)
        if not html:
            continue
        emails = EMAIL_RE.findall(html)
        result = best_from(emails)
        if result:
            return result
    return None

# ── Pattern-guess the most likely email ─────────────────────────────────────
def pattern_email(domain, venue_name=""):
    """
    Return the single most plausible guess for this domain.
    Prefers booking/music prefixes for venues; falls back to info@.
    """
    name_lower = venue_name.lower()
    # If name suggests it's clearly a music/booking operation, prefer those
    is_music_focused = any(w in name_lower for w in
                           ["music", "stage", "theatre", "theater", "concert",
                            "entertainment", "jazz", "blues"])
    prefixes = (BOOKING_PREFIXES if is_music_focused else []) + CONTACT_PREFIXES
    # We can't SMTP-verify, so just return the first (highest priority) prefix
    return f"{prefixes[0]}@{domain}"

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    result = supabase.table("venues") \
        .select("id, name, city, website, contact_email") \
        .is_("contact_email", "null") \
        .execute()
    venues = result.data

    print(f"\n{len(venues)} venues missing email — processing...\n")

    updated = 0
    guessed = 0
    skipped = 0

    for v in venues:
        name    = v["name"]
        website = v.get("website") or ""
        label   = f"{name[:42]:<43}"

        # ── Determine domain ──────────────────────────────────────────────────
        domain = None
        source = ""

        if website:
            domain = domain_from_url(website)
            source = "website"
        else:
            domain = guess_domain_from_name(name)
            source = "guessed"

        if not domain:
            print(f"  ✗  {label} no domain to try")
            skipped += 1
            continue

        # ── Step 1: try scraping first (only for venues with real websites) ──
        email = None
        if website:
            email = scrape_for_email(website)
            if email:
                print(f"  ✓  {label} scraped → {email}")

        # ── Step 2: pattern guess ─────────────────────────────────────────────
        if not email:
            # Verify the domain is real before guessing
            check_domain = domain
            resolves = domain_resolves(check_domain)
            if not resolves:
                # Try www. variant
                resolves = domain_resolves(f"www.{check_domain}")

            if not resolves:
                print(f"  ✗  {label} domain '{domain}' doesn't resolve — skipping")
                skipped += 1
                time.sleep(0.1)
                continue

            email = pattern_email(domain, name)
            flag  = "(guessed)" if source == "guessed" else "(pattern)"
            print(f"  ~  {label} {email}  {flag}")
            guessed += 1

        # ── Persist ───────────────────────────────────────────────────────────
        supabase.table("venues") \
            .update({"contact_email": email}) \
            .eq("id", v["id"]) \
            .execute()
        updated += 1

        time.sleep(0.15)  # gentle on DNS

    print(f"\n── Summary ─────────────────────────────────────────────")
    print(f"  Scraped from site : {updated - guessed}")
    print(f"  Pattern guesses   : {guessed}")
    print(f"  Skipped (no domain): {skipped}")
    print(f"  Total updated     : {updated}\n")

main()
