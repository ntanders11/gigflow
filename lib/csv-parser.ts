/**
 * CSV Parser for GigFlow venue import.
 *
 * Takes the raw text of a CSV file and returns an array of venue objects
 * ready to insert into Supabase. The column names here must match exactly
 * what's in docs/research/venues-all-30mi.csv.
 *
 * Expected CSV columns:
 *   Venue Name, Type, City, Zone, Confidence, Website,
 *   Live Music Details, Contact, Phone
 */

// What a row looks like coming out of the CSV
interface RawVenueRow {
  "Venue Name": string;
  Type: string;
  City: string;
  Zone: string;           // "0-10mi" or "10-30mi"
  Confidence: string;     // "HIGH", "MEDIUM", or "LOW"
  Website: string;
  "Live Music Details": string;
  Contact: string;        // Usually an email address
  Phone: string;
}

// What we need to send to Supabase for each venue.
// zone_id and user_id get filled in at import time (not from the CSV).
export interface VenueInsert {
  name: string;
  type: string | null;
  city: string | null;
  website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  live_music_details: string | null;
  zone_ring: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  stage: "discovered";    // Everything starts here
}

/**
 * Parses the text content of the venues CSV into an array of venue objects.
 *
 * We do this manually (without a library) to keep it simple and avoid
 * adding a dependency just for the one-time import.
 */
export function parseVenuesCsv(csvText: string): VenueInsert[] {
  const lines = csvText.trim().split("\n");

  if (lines.length < 2) {
    throw new Error("CSV appears empty or has no data rows.");
  }

  // First line is the header row
  const headers = parseRow(lines[0]);

  const venues: VenueInsert[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // skip blank lines

    const values = parseRow(line);

    // Build an object keyed by header name
    const raw: Record<string, string> = {};
    headers.forEach((header, index) => {
      raw[header] = (values[index] ?? "").trim();
    });

    const name = raw["Venue Name"];
    if (!name) continue; // skip rows with no venue name

    const confidence = normalizeConfidence(raw["Confidence"]);

    venues.push({
      name,
      type: raw["Type"] || null,
      city: raw["City"] || null,
      website: raw["Website"] || null,
      contact_email: raw["Contact"] || null,
      contact_phone: raw["Phone"] || null,
      live_music_details: raw["Live Music Details"] || null,
      zone_ring: raw["Zone"] || null,
      confidence,
      stage: "discovered",
    });
  }

  return venues;
}

/**
 * Parses a single CSV row, handling quoted fields that may contain commas.
 *
 * Example:
 *   'Bronco Kelly\'s,"Bar & Grill, Dance Hall",Newberg'
 *   → ["Bronco Kelly's", "Bar & Grill, Dance Hall", "Newberg"]
 */
function parseRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      // Handle escaped quotes ("") inside quoted fields
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip the second quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current); // push the last field
  return fields;
}

/**
 * Normalizes the confidence value from the CSV to one of our three enum values.
 * Defaults to MEDIUM if the value is missing or unrecognized.
 */
function normalizeConfidence(value: string): "HIGH" | "MEDIUM" | "LOW" {
  const upper = value.toUpperCase().trim();
  if (upper === "HIGH") return "HIGH";
  if (upper === "LOW") return "LOW";
  return "MEDIUM"; // default for blank, "MEDIUM", or anything unexpected
}
