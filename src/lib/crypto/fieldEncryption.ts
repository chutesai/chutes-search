/**
 * Per-user field encryption for DB-stored content.
 *
 * Derives a unique AES-256-GCM key per user from CHUTES_AUTH_SECRET + userId.
 * Encrypted values are prefixed with "enc:" so plaintext data (anonymous
 * or pre-encryption) passes through transparently.
 */

import crypto from 'crypto';
import { base64UrlEncode, base64UrlDecode } from '@/lib/auth/base64url';

const ENC_PREFIX = 'enc:';
const AES_256_GCM = 'aes-256-gcm';

function getAppSecret(): string {
  const s = process.env.CHUTES_AUTH_SECRET;
  if (!s) throw new Error('CHUTES_AUTH_SECRET is required for field encryption');
  return s;
}

function deriveUserKey(userId: string): Buffer {
  return crypto
    .createHmac('sha256', getAppSecret())
    .update(`field-enc:${userId}`)
    .digest();
}

/**
 * Encrypt a plaintext string. Returns `enc:<iv>.<ct>.<tag>`.
 * If userId is null/undefined, returns the plaintext unchanged.
 */
export function encryptField(
  plaintext: string,
  userId: string | null | undefined,
): string {
  if (!userId) return plaintext;
  const key = deriveUserKey(userId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(AES_256_GCM, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${base64UrlEncode(iv)}.${base64UrlEncode(ct)}.${base64UrlEncode(tag)}`;
}

/**
 * Decrypt a field value. If the value doesn't start with "enc:", returns as-is.
 * If userId is missing but value is encrypted, returns "[encrypted]".
 */
export function decryptField(
  stored: string,
  userId: string | null | undefined,
): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  if (!userId) return '[encrypted]';

  const token = stored.slice(ENC_PREFIX.length);
  const parts = token.split('.');
  if (parts.length !== 3) return '[encrypted]';

  try {
    const key = deriveUserKey(userId);
    const iv = base64UrlDecode(parts[0]);
    const ct = base64UrlDecode(parts[1]);
    const tag = base64UrlDecode(parts[2]);
    const decipher = crypto.createDecipheriv(AES_256_GCM, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return '[encrypted]';
  }
}
