import { describe, it, expect } from "vitest";
import { isReminderDue, localDateAndHour } from "./reminder-timing";

describe("isReminderDue", () => {
  it("is due on the gig's local date once the morning has started", () => {
    // 15:00 UTC on 2026-07-10 = 8 AM Pacific, 11 AM Eastern
    const now = new Date("2026-07-10T15:00:00Z");
    expect(isReminderDue(now, "2026-07-10", "America/Los_Angeles")).toBe(true);
    expect(isReminderDue(now, "2026-07-10", "America/New_York")).toBe(true);
  });
  it("is not due before the local morning", () => {
    // 10:00 UTC = 3 AM Pacific
    expect(isReminderDue(new Date("2026-07-10T10:00:00Z"), "2026-07-10", "America/Los_Angeles")).toBe(false);
  });
  it("uses the gig's zone for what 'today' means", () => {
    // 15:00 UTC on the 10th is already the 11th in Sydney
    const now = new Date("2026-07-10T15:00:00Z");
    expect(localDateAndHour(now, "Australia/Sydney").date).toBe("2026-07-11");
    expect(isReminderDue(now, "2026-07-10", "Australia/Sydney")).toBe(false);
  });
  it("still reaches Pacific time in winter (7 AM)", () => {
    expect(isReminderDue(new Date("2026-12-10T15:00:00Z"), "2026-12-10", "America/Los_Angeles")).toBe(true);
  });
  it("never reminds for a different date", () => {
    expect(isReminderDue(new Date("2026-07-10T15:00:00Z"), "2026-07-11", "America/Los_Angeles")).toBe(false);
  });
});
