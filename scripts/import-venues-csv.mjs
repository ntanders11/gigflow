// One-time import script for Venues - Sheet1.csv
// Run with: node scripts/import-venues-csv.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Minimal CSV parser — handles quoted fields
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const values = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { values.push(cur); cur = ""; }
      else { cur += ch; }
    }
    values.push(cur);
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? "").trim()]));
  });
}

const SUPABASE_URL = "https://rqwlsxjdwuqizkacrtmb.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxd2xzeGpkd3VxaXprYWNydG1iIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDIzMjgxOSwiZXhwIjoyMDg5ODA4ODE5fQ.G0VJaS0GeKz11J-8PAg0yvvZcmNSahtRsLuq6LqSh6A";
const USER_ID = "d002fe32-fd2b-48a8-9874-60d2c2380bbf";
const ZONE_ID = "e101908f-0d7d-4a96-a14f-661f92d5a6a9";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Known aliases — CSV name → canonical DB name (for spelling variants)
const ALIASES = {
  "mera viglioso": "meraviglioso winery",
  "the bad space": "the bad space at santiam brewing",
};

const STOP_WORDS = new Set([
  "the","a","an","and","or","of","at","in","on","for","with","by",
  "bar","grill","saloon","tavern","pub","brewery","brewing",
  "winery","wine","wines","vineyard","vineyards","tasting","room",
  "estate","estates","lounge","club","inn","spa","hotel",
  "restaurant","cafe","cellars","cellar","ranch","family",
  "sports","pdx","center","experience","house","social",
]);

function normalizeToWords(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// Returns true if csvName is a duplicate of any existing DB name
function isDuplicate(csvName, existingNames) {
  const key = csvName.toLowerCase().trim();
  // Check alias map first
  if (ALIASES[key]) {
    return existingNames.some(n => n.toLowerCase().trim() === ALIASES[key]);
  }

  const csvWords = normalizeToWords(csvName);
  if (csvWords.length === 0) return false;
  const csvSet = new Set(csvWords);

  for (const existingName of existingNames) {
    const existingWords = normalizeToWords(existingName);
    if (existingWords.length === 0) continue;
    const existingSet = new Set(existingWords);

    // Match if CSV's key words are all contained in the existing name's words
    // OR existing's key words are all contained in CSV's words
    const csvSubset = csvWords.every(w => existingSet.has(w));
    const existingSubset = existingWords.every(w => csvSet.has(w));
    if (csvSubset || existingSubset) return true;
  }
  return false;
}

// Clean email — return null if not a real email
function cleanEmail(val) {
  if (!val) return null;
  const v = val.trim();
  if (!v || v.toLowerCase().includes("ig") || v.toLowerCase().includes("online form") || v.toLowerCase().includes("online") || !v.includes("@")) return null;
  return v;
}

// Determine stage
function getStage(row) {
  if (row["2026"] === "TRUE") return "booked";
  if (row["Emailed"] === "TRUE") return "contacted";
  return "discovered";
}

// Determine confidence
function getConfidence(row) {
  if (row["Past"] === "TRUE" || row["2026"] === "TRUE") return "HIGH";
  return "MEDIUM";
}

// Build notes from Deets + Notes columns
function buildNotes(row) {
  const parts = [row["Deets"], row["Notes"]].map(s => s?.trim()).filter(Boolean);
  return parts.join(" | ") || null;
}

async function main() {
  // Load CSV
  const csv = readFileSync("/Users/tayloranderson/Downloads/Venues - Sheet1.csv", "utf-8");
  const rows = parseCSV(csv);

  // Get existing venue names
  const { data: existing } = await supabase
    .from("venues")
    .select("name")
    .eq("user_id", USER_ID);

  const existingList = (existing ?? []).map(v => v.name);

  // Build venues to insert
  const toInsert = [];
  const skipped = [];

  for (const row of rows) {
    const name = row["Venue"]?.trim();
    if (!name) continue;

    if (isDuplicate(name, existingList)) {
      skipped.push(name);
      continue;
    }

    toInsert.push({
      user_id: USER_ID,
      zone_id: ZONE_ID,
      name,
      contact_name: row["Contact"]?.trim() || null,
      contact_email: cleanEmail(row["Email"]),
      contact_phone: row["Phone Number"]?.trim() || null,
      notes: buildNotes(row),
      stage: getStage(row),
      confidence: getConfidence(row),
      live_music_details: row["Deets"]?.trim() || null,
    });
  }

  console.log(`\nCSV rows: ${rows.length}`);
  console.log(`Already in DB (skipping): ${skipped.length}`);
  console.log(`New venues to import: ${toInsert.length}`);
  if (skipped.length) console.log(`\nSkipped:\n  ${skipped.join("\n  ")}`);

  if (toInsert.length === 0) {
    console.log("\nNothing to import.");
    return;
  }

  console.log(`\nInserting ${toInsert.length} venues...`);
  const { data, error } = await supabase.from("venues").insert(toInsert).select("name, stage");

  if (error) {
    console.error("Insert error:", error.message);
    return;
  }

  console.log(`\n✓ Imported ${data.length} venues:`);
  for (const v of data) {
    console.log(`  ${v.name} → ${v.stage}`);
  }
}

main().catch(console.error);
