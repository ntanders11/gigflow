import { describe, it, expect } from "vitest";
import { decideSend, canSendEmail, pickConnection } from "@/lib/email/send-rules";

const gmailActive = { provider: "gmail", status: "active" as const, updated_at: "2026-10-01T00:00:00Z" };
const outlookActive = { provider: "outlook", status: "active" as const, updated_at: "2026-10-10T00:00:00Z" };
const outlookBroken = { provider: "outlook", status: "needs_reconnect" as const, updated_at: "2026-10-12T00:00:00Z" };

describe("decideSend", () => {
  it("is blocked as not_connected when the artist has no connection at all", () => {
    expect(decideSend([])).toEqual({ kind: "blocked", code: "not_connected" });
  });
  it("is blocked as needs_reconnect when every connection is broken", () => {
    expect(decideSend([outlookBroken])).toEqual({ kind: "blocked", code: "needs_reconnect" });
  });
  it("uses a working connection", () => {
    expect(decideSend([gmailActive])).toEqual({ kind: "use", connection: gmailActive });
  });
  it("never picks a broken connection even if it is newer than a working one", () => {
    const d = decideSend([gmailActive, outlookBroken]);
    expect(d).toEqual({ kind: "use", connection: gmailActive });
  });
  it("picks the most recently updated of two working connections", () => {
    const d = decideSend([gmailActive, outlookActive]);
    expect(d).toEqual({ kind: "use", connection: outlookActive });
  });
});

describe("canSendEmail", () => {
  it("is false with no connections or only broken ones, true with a working one", () => {
    expect(canSendEmail([])).toBe(false);
    expect(canSendEmail([{ status: "needs_reconnect" }])).toBe(false);
    expect(canSendEmail([{ status: "needs_reconnect" }, { status: "active" }])).toBe(true);
  });
});

describe("pickConnection", () => {
  it("returns null for no connections", () => {
    expect(pickConnection([])).toBeNull();
  });
});
