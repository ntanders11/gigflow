// lib/messages/rules.ts
// Pure rules for messaging — no server or database imports, so both the
// API routes and the browser UI can use the exact same limits.

export const MESSAGE_BUCKET = "message-attachments";
export const MAX_BODY_LENGTH = 2000;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return cleaned || "file";
}

export function validateMessageInput(body: unknown, hasAttachment: boolean): Result<{ body: string }> {
  if (body !== undefined && body !== null && typeof body !== "string") {
    return { ok: false, error: "Message must be text." };
  }
  const text = (body ?? "").toString().trim();
  if (text.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `Messages can be up to ${MAX_BODY_LENGTH.toLocaleString("en-US")} characters.` };
  }
  if (!text && !hasAttachment) {
    return { ok: false, error: "Write a message or attach a file." };
  }
  return { ok: true, body: text };
}

export function validateAttachmentDeclaration(type: string, size: number): Result {
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: "Only images (JPEG, PNG, WebP, GIF) and PDFs can be attached." };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "That file looks empty." };
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "Files can be up to 10 MB." };
  }
  return { ok: true };
}

// Looks at the first bytes of a file to decide what it really is, so a
// renamed file can't sneak past the allowed-types list.
export function sniffAttachmentType(bytes: Uint8Array): string | null {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (bytes.length >= 4 && starts([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (bytes.length >= 8 && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 3 && starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 6 && starts([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (bytes.length >= 12 && starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export function blockedSendError(
  blockedBy: "artist" | "venue" | null,
  myRole: "artist" | "venue"
): string | null {
  if (!blockedBy) return null;
  if (blockedBy === myRole) return "You've blocked this conversation. Unblock it to send messages.";
  return "You can't send messages in this conversation.";
}
