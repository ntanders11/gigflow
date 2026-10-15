// lib/promo-photos/rules.ts
// Pure rules for artist promo photos — no server or database imports, so the
// API routes and the browser UI share the exact same limits.
import { sniffAttachmentType } from "@/lib/messages/rules";

export const PROMO_BUCKET = "promo-photos";
export const MAX_PROMO_PHOTOS = 8;
export const MAX_PROMO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_PROMO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

type Result = { ok: true } | { ok: false; error: string };

export function validatePromoDeclaration(type: string, size: number): Result {
  if (!(ALLOWED_PROMO_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: "Only JPEG, PNG, or WebP photos can be added." };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "That file looks empty." };
  }
  if (size > MAX_PROMO_BYTES) {
    return { ok: false, error: "Photos can be up to 10 MB each." };
  }
  return { ok: true };
}

// Looks at the first bytes of the stored file, so a renamed non-image can't
// sneak past the type list. Returns null for anything not an allowed photo.
export function sniffPromoType(bytes: Uint8Array): string | null {
  const type = sniffAttachmentType(bytes);
  return type && (ALLOWED_PROMO_TYPES as readonly string[]).includes(type) ? type : null;
}

// Uploaded files live under a folder named for the artist's user id; a photo
// can only be registered if its path is inside the caller's own folder.
export function isOwnPromoPath(userId: string, path: string): boolean {
  return path.startsWith(`${userId}/`) && !path.includes("..");
}

export function canAddMore(currentCount: number): boolean {
  return currentCount < MAX_PROMO_PHOTOS;
}
