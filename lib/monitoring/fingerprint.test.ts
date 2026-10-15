import { describe, it, expect } from "vitest";
import { errorFingerprint } from "./fingerprint";

describe("errorFingerprint", () => {
  it("groups the same problem with different numbers or ids", () => {
    const a = errorFingerprint("server", "Failed for venue 123", "/api/venues/5");
    const b = errorFingerprint("server", "Failed for venue 456", "/api/venues/9");
    expect(a).toBe(b);
    const u1 = errorFingerprint("server", "x", "/venues/0b9e3c1e-1111-4222-8333-444455556666");
    const u2 = errorFingerprint("server", "x", "/venues/aaaaaaaa-1111-4222-8333-444455556666");
    expect(u1).toBe(u2);
  });
  it("keeps different problems and sources apart", () => {
    expect(errorFingerprint("server", "A broke", "/x")).not.toBe(errorFingerprint("server", "B broke", "/x"));
    expect(errorFingerprint("server", "A broke", "/x")).not.toBe(errorFingerprint("browser", "A broke", "/x"));
  });
});
