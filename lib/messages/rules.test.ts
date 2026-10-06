import { describe, it, expect } from "vitest";
import {
  MAX_BODY_LENGTH,
  MAX_ATTACHMENT_BYTES,
  sanitizeFileName,
  validateMessageInput,
  validateAttachmentDeclaration,
  sniffAttachmentType,
  blockedSendError,
} from "@/lib/messages/rules";

describe("sanitizeFileName", () => {
  it("strips directories", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
  });
  it("replaces unsafe characters but keeps the extension", () => {
    expect(sanitizeFileName("stage plot (v2).pdf")).toBe("stage_plot_v2_.pdf");
  });
  it("never returns an empty name", () => {
    expect(sanitizeFileName("...")).toBe("file");
  });
  it("keeps the tail of very long names so the extension survives", () => {
    const name = "a".repeat(200) + ".png";
    const out = sanitizeFileName(name);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith(".png")).toBe(true);
  });
});

describe("validateMessageInput", () => {
  it("trims text", () => {
    expect(validateMessageInput("  hi  ", false)).toEqual({ ok: true, body: "hi" });
  });
  it("rejects empty text with no attachment", () => {
    expect(validateMessageInput("   ", false).ok).toBe(false);
    expect(validateMessageInput(undefined, false).ok).toBe(false);
  });
  it("allows empty text when there is an attachment", () => {
    expect(validateMessageInput("", true)).toEqual({ ok: true, body: "" });
    expect(validateMessageInput(undefined, true)).toEqual({ ok: true, body: "" });
  });
  it("rejects non-string text", () => {
    expect(validateMessageInput(42, false).ok).toBe(false);
  });
  it("rejects text over the limit", () => {
    expect(validateMessageInput("a".repeat(MAX_BODY_LENGTH + 1), false).ok).toBe(false);
    expect(validateMessageInput("a".repeat(MAX_BODY_LENGTH), false).ok).toBe(true);
  });
});

describe("validateAttachmentDeclaration", () => {
  it("accepts allowed types at the size limit", () => {
    expect(validateAttachmentDeclaration("application/pdf", MAX_ATTACHMENT_BYTES).ok).toBe(true);
    expect(validateAttachmentDeclaration("image/png", 1000).ok).toBe(true);
  });
  it("rejects other types", () => {
    expect(validateAttachmentDeclaration("application/zip", 1000).ok).toBe(false);
    expect(validateAttachmentDeclaration("audio/mpeg", 1000).ok).toBe(false);
  });
  it("rejects oversized and empty files", () => {
    expect(validateAttachmentDeclaration("image/png", MAX_ATTACHMENT_BYTES + 1).ok).toBe(false);
    expect(validateAttachmentDeclaration("image/png", 0).ok).toBe(false);
  });
});

describe("sniffAttachmentType", () => {
  it("recognizes PDF", () => {
    expect(sniffAttachmentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
  });
  it("recognizes PNG", () => {
    expect(sniffAttachmentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
  });
  it("recognizes JPEG", () => {
    expect(sniffAttachmentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });
  it("recognizes GIF", () => {
    expect(sniffAttachmentType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
  });
  it("recognizes WebP", () => {
    const b = new Uint8Array(12);
    b.set([0x52, 0x49, 0x46, 0x46], 0);
    b.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffAttachmentType(b)).toBe("image/webp");
  });
  it("returns null for anything else", () => {
    expect(sniffAttachmentType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // Windows .exe
    expect(sniffAttachmentType(new Uint8Array([]))).toBeNull();
  });
});

describe("blockedSendError", () => {
  it("returns null when nobody is blocked", () => {
    expect(blockedSendError(null, "venue")).toBeNull();
  });
  it("tells the blocker how to continue", () => {
    expect(blockedSendError("venue", "venue")).toMatch(/unblock/i);
  });
  it("gives the blocked side a neutral message", () => {
    const msg = blockedSendError("venue", "artist");
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/blocked/i);
  });
});
