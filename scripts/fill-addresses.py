"""
Fill missing address fields via Google Places text search.

Run with: python3 scripts/fill-addresses.py
"""

import time
import json
import urllib.request
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

# ── Google Places lookup ──────────────────────────────────────────────────────
def places_lookup(name, city):
    query = f"{name} {city or ''}".strip()
    payload = json.dumps({"textQuery": query}).encode()

    req = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchText",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_KEY,
            "X-Goog-FieldMask": "places.displayName,places.formattedAddress",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            for place in data.get("places", []):
                addr = place.get("formattedAddress", "").strip()
                # Only accept addresses that start with a street number
                if addr and addr[0].isdigit():
                    return addr
    except Exception as e:
        print(f"      API error: {e}")
    return None

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    result = supabase.table("venues") \
        .select("id, name, city, address") \
        .is_("address", "null") \
        .execute()
    venues = result.data

    print(f"\n{len(venues)} venues missing address — looking them up...\n")

    found = 0
    not_found = 0

    for v in venues:
        label = f"{v['name'][:45]:<46}"
        addr  = places_lookup(v["name"], v.get("city"))

        if addr:
            supabase.table("venues") \
                .update({"address": addr}) \
                .eq("id", v["id"]) \
                .execute()
            print(f"  ✓  {label} {addr}")
            found += 1
        else:
            print(f"  –  {label} not found")
            not_found += 1

        time.sleep(0.25)

    print(f"\n── Summary ──────────────────────────────")
    print(f"  Addresses added : {found}")
    print(f"  Not found       : {not_found}\n")

main()
