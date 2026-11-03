import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { cryptoEnv } from "@/env";

const VERSION = "v1";

function key(): Buffer {
  return Buffer.from(cryptoEnv().TOKEN_ENCRYPTION_KEY, "base64");
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, each part base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string): string {
  const [version, iv, tag, ct] = envelope.split(".");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Unsupported secret envelope");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
