import { describe, it, expect } from "vitest";
import { buildPipelineIndex, isInPipeline, phoneKey, findPipelineMatch, blanksToFill } from "./duplicates";

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

describe("blanksToFill", () => {
  const found = { website: "https://x.com", phone: "503-555-1212", address: "1 Main St", city: "Newberg", type: "bar" };
  it("fills only the blanks", () => {
    expect(blanksToFill({ name: "A", website: null, contact_phone: "111", address: "", city: "Newberg", type: null }, found)).toEqual({
      website: "https://x.com",
      address: "1 Main St",
      type: "bar",
    });
  });
  it("never overwrites what the artist entered", () => {
    expect(blanksToFill({ name: "A", website: "mine.com", contact_phone: "1", address: "a", city: "c", type: "t" }, found)).toEqual({});
  });
  it("leaves alone a field the artist edited by hand, even if it is blank now", () => {
    expect(
      blanksToFill({ name: "A", website: "", address: null, manual_edit_fields: ["website"] }, found)
    ).toEqual({ contact_phone: "503-555-1212", address: "1 Main St", city: "Newberg", type: "bar" });
  });
  it("adds nothing when Discover has nothing new", () => {
    expect(blanksToFill({ name: "A" }, { website: null, phone: null, address: null, city: null, type: null })).toEqual({});
  });
});

describe("findPipelineMatch", () => {
  it("returns the saved venue it matched", () => {
    const idx = buildPipelineIndex([{ id: "v1", name: "Dillon's" }]);
    expect(findPipelineMatch(idx, "Dillons Bar & Grill", null)?.id).toBe("v1");
    expect(findPipelineMatch(idx, "Scrooges", null)).toBeNull();
  });
});
