"""
Patch contact_name and contact_email onto recently-imported venues using data
from the NW Venues.numbers spreadsheet.

Run with: python3 scripts/patch-contact-info.py
"""

import re
import os
from pathlib import Path
from numbers_parser import Document
from supabase import create_client

# ── Load .env.local ──────────────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / ".env.local"
env = {}
for line in env_path.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    key, _, val = line.partition("=")
    env[key.strip()] = val.strip()

SUPABASE_URL = env["NEXT_PUBLIC_SUPABASE_URL"]
SERVICE_KEY  = env["SUPABASE_SERVICE_ROLE_KEY"]

supabase = create_client(SUPABASE_URL, SERVICE_KEY)

# ── Extract clean email from a raw cell value ─────────────────────────────────
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
SKIP_DOMAINS = {"wixpress.com", "squarespace.com", "example.com", "sentry.io",
                "w3.org", "schema.org", "yoursite.com", "domain.com"}

def extract_email(raw):
    """Return the first valid-looking email address found in raw text, or None."""
    if not raw:
        return None
    matches = EMAIL_RE.findall(str(raw))
    for m in matches:
        domain = m.split("@")[-1].lower()
        # Skip obviously fake / generic domains
        if any(bad in domain for bad in SKIP_DOMAINS):
            continue
        # Skip clearly truncated addresses (e.g. "sandy@pottersvineyard.")
        if m.endswith("."):
            continue
        return m.lower()
    return None

# ── Read NW Venues.numbers ────────────────────────────────────────────────────
numbers_path = Path("/Users/tayloranderson/Desktop/NW Venues.numbers")
doc = Document(str(numbers_path))
sheet = doc.sheets[0]
table = sheet.tables[0]

# Build a lookup: normalized name → {contact_name, contact_email, raw_email}
from_sheet = {}
for row in table.iter_rows():
    cells = [c.value for c in row]
    name     = cells[1]
    city_raw = cells[2]
    contact  = cells[3]
    email_raw = cells[4]
    if not name:
        continue

    # Simplify name for matching (lower + strip punctuation)
    key = re.sub(r"[^a-z0-9 ]", "", str(name).lower()).strip()

    email = extract_email(email_raw)
    from_sheet[key] = {
        "name": name,
        "city": city_raw,
        "contact_name": str(contact).strip() if contact and str(contact).strip() not in ("None", "-") else None,
        "contact_email": email,
        "raw_email": email_raw,
    }

print(f"Loaded {len(from_sheet)} venues from spreadsheet\n")

# ── Fetch all user venues from Supabase ───────────────────────────────────────
result = supabase.table("venues") \
    .select("id, name, contact_name, contact_email") \
    .execute()

venues = result.data
print(f"Found {len(venues)} venues in DB\n")

# ── Match and patch ───────────────────────────────────────────────────────────
updated = 0
skipped = 0
not_found = 0

for venue in venues:
    key = re.sub(r"[^a-z0-9 ]", "", venue["name"].lower()).strip()

    # Try exact normalized match, then partial match
    sheet_row = from_sheet.get(key)
    if not sheet_row:
        # Fallback: check if any sheet key starts with or contains the venue name key
        for sk, sv in from_sheet.items():
            if key in sk or sk in key:
                sheet_row = sv
                break

    if not sheet_row:
        not_found += 1
        continue

    patch = {}
    # Only add contact_name if DB field is empty
    if not venue.get("contact_name") and sheet_row["contact_name"]:
        patch["contact_name"] = sheet_row["contact_name"]
    # Only add contact_email if DB field is empty and we have a valid email
    if not venue.get("contact_email") and sheet_row["contact_email"]:
        patch["contact_email"] = sheet_row["contact_email"]

    if not patch:
        skipped += 1
        print(f"  ─ {venue['name']:<45} already has contact info")
        continue

    supabase.table("venues").update(patch).eq("id", venue["id"]).execute()
    updated += 1
    parts = []
    if "contact_name" in patch:  parts.append(f"name: {patch['contact_name']}")
    if "contact_email" in patch: parts.append(f"email: {patch['contact_email']}")
    print(f"  ✓ {venue['name']:<45} {' | '.join(parts)}")

print(f"\n── Summary ──────────────────────────────")
print(f"  Updated : {updated}")
print(f"  Already had info : {skipped}")
print(f"  Not in spreadsheet : {not_found}")
