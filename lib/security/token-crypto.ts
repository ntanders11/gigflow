// Scrambles the Gmail/Outlook tokens saved in email_connections so a copy of
// the database alone can't be used to send mail as an artist. AES-256-GCM with
// a key from TOKEN_ENCRYPTION_KEY (64 hex characters).
//
// Safe to roll out in any order: without the key, tokens are saved as plain
// text exactly as before; and reading accepts both scrambled and old plain
// tokens, so nobody is disconnected while the existing rows are converted.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}

export function isEncryptedToken(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptToken(plain: string): string {
  const key = getKey();
  if (!key || isEncryptedToken(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  if (!isEncryptedToken(stored)) return stored;
  const key = getKey();
  if (!key) throw new Error("A token is encrypted but TOKEN_ENCRYPTION_KEY is not set");
  const [iv, tag, data] = stored.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
