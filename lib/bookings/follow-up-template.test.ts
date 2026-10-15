import { describe, it, expect } from "vitest";
import { renderFollowUpBody, DEFAULT_FOLLOW_UP_TEMPLATE } from "./follow-up-template";

describe("renderFollowUpBody", () => {
  it("fills in the venue name and adds the signature", () => {
    const out = renderFollowUpBody("Hi! Playing at {venue}?", "The Bar", "Sam\n555-1212");
    expect(out).toBe("Hi! Playing at The Bar?\n\nSam\n555-1212");
  });
  it("uses the default wording when the artist hasn't written their own", () => {
    expect(renderFollowUpBody(null, "The Bar", "Sam")).toContain("The Bar");
    expect(renderFollowUpBody("   ", "The Bar", "Sam")).toContain("follow up on my email");
    expect(DEFAULT_FOLLOW_UP_TEMPLATE).toContain("{venue}");
  });
  it("works without a signature", () => {
    expect(renderFollowUpBody("Hello {venue}", "X", "")).toBe("Hello X");
  });
});
