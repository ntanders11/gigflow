import { describe, it, expect } from "vitest";
import { suggestRemindDate } from "./suggest-date";

const today = new Date(2026, 9, 27); // Oct 27, 2026

describe("suggestRemindDate", () => {
  it("picks up a named month", () => {
    expect(suggestRemindDate("Thanks! We're not booking music until January.", today)).toEqual({ date: "2027-01-01", label: "in January" });
  });
  it("picks up a season", () => {
    expect(suggestRemindDate("Try us again next spring", today)?.date).toBe("2027-03-01");
  });
  it("picks up next year / after the holidays", () => {
    expect(suggestRemindDate("We're full for this year, check back next year", today)?.date).toBe("2027-01-05");
    expect(suggestRemindDate("Reach out after the holidays", today)?.date).toBe("2027-01-05");
  });
  it("treats a plain scheduling reply as no suggestion", () => {
    expect(suggestRemindDate("Saturday July 12 works great for us", today)).toBeNull();
    expect(suggestRemindDate("Sounds good, send over your rates", today)).toBeNull();
  });
  it("doesn't treat the word 'may' as a month", () => {
    expect(suggestRemindDate("We may be able to fit you in, check back soon", today)).toBeNull();
    expect(suggestRemindDate("Not booking until May", today)?.date).toBe("2027-05-01");
  });
});
