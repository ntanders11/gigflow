import { describe, it, expect } from "vitest";
import { remindOptions, isRemindDue } from "./remind-dates";

const by = (d: Date) => Object.fromEntries(remindOptions(d).map((o) => [o.key, o.date]));

describe("remindOptions", () => {
  it("adds months, clamping short months", () => {
    expect(by(new Date(2026, 9, 22))["1m"]).toBe("2026-11-22");
    expect(by(new Date(2026, 9, 22))["3m"]).toBe("2027-01-22");
    expect(by(new Date(2026, 0, 31))["1m"]).toBe("2026-02-28");
  });
  it("picks the next January and spring after today", () => {
    expect(by(new Date(2026, 9, 22)).jan).toBe("2027-01-05");
    expect(by(new Date(2026, 9, 22)).spring).toBe("2027-03-01");
    expect(by(new Date(2026, 0, 2)).jan).toBe("2026-01-05");
    expect(by(new Date(2026, 0, 10)).jan).toBe("2027-01-05");
    expect(by(new Date(2026, 3, 1)).spring).toBe("2027-03-01");
  });
});

describe("isRemindDue", () => {
  it("is due on or after the date, never without one", () => {
    expect(isRemindDue("2026-11-01", "2026-11-01")).toBe(true);
    expect(isRemindDue("2026-11-01", "2026-12-01")).toBe(true);
    expect(isRemindDue("2026-11-02", "2026-11-01")).toBe(false);
    expect(isRemindDue(null, "2026-11-01")).toBe(false);
  });
});
