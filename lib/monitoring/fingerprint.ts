import { createHash } from "crypto";

// Groups repeats of the same problem into one row. Numbers and ids inside the
// message are blanked out so "failed for venue 123" and "…venue 456" match.
export function errorFingerprint(source: string, message: string, path: string | null): string {
  const normalized = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300);
  // Dynamic path pieces (ids) are blanked too, so one bug on many pages groups.
  const route = (path ?? "").split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d+/g, "<n>");
  return createHash("sha256").update(`${source}|${route}|${normalized}`).digest("hex").slice(0, 32);
}
