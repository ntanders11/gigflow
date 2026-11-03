import { describe, it, expect } from "vitest";
import { buildPipelineIndex, isInPipeline, phoneKey } from "./duplicates";

const index = buildPipelineIndex([
  { name: "Dillon's", contact_phone: null },
  { name: "Old Oak", contact_phone: "(503) 555-1212" },
  { name: "Bar", contact_phone: null },
]);

describe("isInPipeline", () => {
  it("matches spelling differences", () => {
    expect(isInPipeline(index, "Dillons Bar & Grill", null)).toBe(true);
    expect(isInPipeline(index, "The Old Oak Pub", null)).toBe(true);
  });
  it("matches on phone even when the names differ", () => {
    expect(isInPipeline(index, "Totally Different", "503-555-1212")).toBe(true);
    expect(isInPipeline(index, "Totally Different", "+1 503 555 1212")).toBe(true);
  });
  it("does not match unrelated venues, or names too short to trust", () => {
    expect(isInPipeline(index, "Scrooges", "503-555-9999")).toBe(false);
    expect(isInPipeline(index, "Bar", null)).toBe(false);
  });
});

describe("phoneKey", () => {
  it("ignores numbers that are too short", () => {
    expect(phoneKey("555-1212")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});
