// AES-256-GCM encryption for broker credentials.
// Server-only. The key comes from BROKER_CREDENTIALS_KEY (auto-provisioned
// random secret) hashed to exactly 32 bytes. Plaintext credentials never
// touch the database and are never returned to the browser.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env["BROKER_CREDENTIALS_KEY"];
  if (!raw) throw new Error("BROKER_CREDENTIALS_KEY is not configured");
  return createHash("sha256").update(raw).digest();
}

export function encryptCredentials(value: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptCredentials<T = Record<string, string>>(stored: string): T {
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8")) as T;
}
