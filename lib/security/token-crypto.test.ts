import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken, isEncryptedToken } from "./token-crypto";

const KEY = "a".repeat(64);

describe("token-crypto", () => {
  beforeEach(() => { process.env.TOKEN_ENCRYPTION_KEY = KEY; });
  afterEach(() => { delete process.env.TOKEN_ENCRYPTION_KEY; });

  it("round-trips a token and hides the original", () => {
    const stored = encryptToken("ya29.secret-token");
    expect(isEncryptedToken(stored)).toBe(true);
    expect(stored).not.toContain("secret-token");
    expect(decryptToken(stored)).toBe("ya29.secret-token");
  });
  it("uses a fresh random value each time", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });
  it("does not double-encrypt", () => {
    const once = encryptToken("x");
    expect(encryptToken(once)).toBe(once);
  });
  it("still reads old plain-text tokens", () => {
    expect(decryptToken("plain-old-token")).toBe("plain-old-token");
  });
  it("saves plain text when no key is set yet", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(encryptToken("abc")).toBe("abc");
  });
  it("refuses a scrambled token with no key, and a tampered one", () => {
    const stored = encryptToken("abc");
    expect(() => decryptToken(stored.slice(0, -2) + "xx")).toThrow();
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => decryptToken(stored)).toThrow();
  });
});
