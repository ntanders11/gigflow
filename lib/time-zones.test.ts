import { describe, it, expect } from "vitest";
import { gigTimeZone, isValidTimeZone, DEFAULT_TIME_ZONE } from "./time-zones";

describe("time zones", () => {
  it("accepts real zones and rejects junk", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
  it("prefers the venue's zone, then the artist's, then Pacific", () => {
    expect(gigTimeZone("America/New_York", "America/Chicago")).toBe("America/New_York");
    expect(gigTimeZone(null, "America/Chicago")).toBe("America/Chicago");
    expect(gigTimeZone(undefined, undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(gigTimeZone("bogus", "bogus")).toBe(DEFAULT_TIME_ZONE);
  });
});
