import { describe, it, expect } from "vitest";
import { isAutoReply, nextStageForReply, normalizeEmail } from "./match";

const msg = (over = {}) => ({ id: "1", fromAddress: "owner@bar.com", subject: "Re: live music", receivedAt: "2026-10-22T00:00:00Z", ...over });

describe("isAutoReply", () => {
  it("lets a normal reply through", () => {
    expect(isAutoReply(msg())).toBe(false);
  });
  it("catches out-of-office and bounce subjects", () => {
    expect(isAutoReply(msg({ subject: "Automatic reply: live music" }))).toBe(true);
    expect(isAutoReply(msg({ subject: "Out of Office: back Monday" }))).toBe(true);
    expect(isAutoReply(msg({ subject: "Undeliverable: live music" }))).toBe(true);
  });
  it("catches robots and auto headers", () => {
    expect(isAutoReply(msg({ fromAddress: "mailer-daemon@x.com" }))).toBe(true);
    expect(isAutoReply(msg({ headers: [{ name: "Auto-Submitted", value: "auto-replied" }] }))).toBe(true);
    expect(isAutoReply(msg({ headers: [{ name: "Auto-Submitted", value: "no" }] }))).toBe(false);
    expect(isAutoReply(msg({ headers: [{ name: "Precedence", value: "bulk" }] }))).toBe(true);
  });
});

describe("nextStageForReply", () => {
  it("moves only contacted/discovered to responded", () => {
    expect(nextStageForReply("contacted")).toBe("responded");
    expect(nextStageForReply("discovered")).toBe("responded");
    for (const s of ["dormant", "responded", "negotiating", "booked"]) expect(nextStageForReply(s)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Owner@Bar.COM ")).toBe("owner@bar.com");
    expect(normalizeEmail(null)).toBe("");
  });
});
