import { describe, it, expect } from "vitest";
import {
  MAX_PROMO_PHOTOS,
  MAX_PROMO_BYTES,
  validatePromoDeclaration,
  sniffPromoType,
  isOwnPromoPath,
  canAddMore,
} from "@/lib/promo-photos/rules";

describe("validatePromoDeclaration", () => {
  it("accepts a normal JPEG", () => {
    expect(validatePromoDeclaration("image/jpeg", 2_000_000)).toEqual({ ok: true });
  });
  it("rejects GIFs and PDFs (messages allow them, promo photos don't)", () => {
    expect(validatePromoDeclaration("image/gif", 1000).ok).toBe(false);
    expect(validatePromoDeclaration("application/pdf", 1000).ok).toBe(false);
  });
  it("rejects empty and oversized files", () => {
    expect(validatePromoDeclaration("image/png", 0).ok).toBe(false);
    expect(validatePromoDeclaration("image/png", MAX_PROMO_BYTES + 1).ok).toBe(false);
    expect(validatePromoDeclaration("image/png", MAX_PROMO_BYTES).ok).toBe(true);
  });
});

describe("sniffPromoType", () => {
  it("recognizes JPEG and PNG bytes", () => {
    expect(sniffPromoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffPromoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
  });
  it("rejects a PDF and a GIF even though they're real file types", () => {
    expect(sniffPromoType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeNull();
    expect(sniffPromoType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
  });
  it("rejects random bytes", () => {
    expect(sniffPromoType(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe("isOwnPromoPath", () => {
  it("accepts a path inside the caller's own folder", () => {
    expect(isOwnPromoPath("user-1", "user-1/abc-photo.jpg")).toBe(true);
  });
  it("rejects another user's folder and path tricks", () => {
    expect(isOwnPromoPath("user-1", "user-2/abc-photo.jpg")).toBe(false);
    expect(isOwnPromoPath("user-1", "user-1/../user-2/x.jpg")).toBe(false);
    expect(isOwnPromoPath("user-1", "user-10/x.jpg")).toBe(false);
  });
});

describe("canAddMore", () => {
  it("allows up to the limit and no further", () => {
    expect(MAX_PROMO_PHOTOS).toBe(8);
    expect(canAddMore(7)).toBe(true);
    expect(canAddMore(8)).toBe(false);
  });
});
