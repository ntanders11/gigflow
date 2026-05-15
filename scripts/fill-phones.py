"""
For venues missing contact_email, look up their phone number via Google Places
and store it in contact_phone.

Run with: python3 scripts/fill-phones.py
"""

import time
import json
import urllib.request
import urllib.parse
from pathlib import Path
from supabase import create_client

# ── Load .env.local ──────────────────────────────────────────────────────────
env = {}
for line in (Path(__file__).parent.parent / ".env.local").read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    k, _, v = line.partition("=")
    env[k.strip()] = v.strip()

SUPABASE_URL = env["NEXT_PUBLIC_SUPABASE_URL"]
SERVICE_KEY  = env["SUPABASE_SERVICE_ROLE_KEY"]
GOOGLE_KEY   = env["GOOGLE_PLACES_API_KEY"]

supabase = create_client(SUPABASE_URL, SERVICE_KEY)

# ── Google Places text search ─────────────────────────────────────────────────
def places_lookup(name, city):
    query = f"{name} {city or ''}".strip()
    payload = json.dumps({
        "textQuery": query,
    }).encode()

    req = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchText",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_KEY,
            "X-Goog-FieldMask": (
                "places.displayName,"
                "places.nationalPhoneNumber,"
                "places.internationalPhoneNumber,"
                "places.formattedAddress"
            ),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            for place in data.get("places", []):
                phone = (
                    place.get("nationalPhoneNumber")
                    or place.get("internationalPhoneNumber")
                )
                if phone:
                    return phone
    except Exception as e:
        print(f"      Places error: {e}")
    return None

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    result = supabase.table("venues") \
        .select("id, name, city, contact_email, contact_phone") \
        .is_("contact_email", "null") \
        .execute()
    venues = result.data

    needs_phone = [v for v in venues if not v.get("contact_phone")]
    has_phone   = [v for v in venues if v.get("contact_phone")]

    print(f"\n{len(venues)} venues missing email:")
    print(f"  {len(has_phone)} already have a phone number")
    print(f"  {len(needs_phone)} need a phone number looked up\n")

    found = 0
    not_found = 0

    for v in needs_phone:
        label = f"{v['name'][:45]:<46}"
        phone = places_lookup(v["name"], v.get("city"))

        if phone:
            supabase.table("venues") \
                .update({"contact_phone": phone}) \
                .eq("id", v["id"]) \
                .execute()
            print(f"  ✓  {label} {phone}")
            found += 1
        else:
            print(f"  –  {label} not found")
            not_found += 1

        time.sleep(0.3)  # stay polite to the API

    print(f"\n── Summary ──────────────────────────────")
    print(f"  Phone numbers added : {found}")
    print(f"  Not found           : {not_found}\n")

main()
