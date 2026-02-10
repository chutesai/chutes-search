import crypto from 'crypto';
import { base64UrlDecode, base64UrlEncode } from './base64url';

const AES_256_GCM = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

export function sealJson<T extends Record<string, unknown>>(
  payload: T,
  secret: string,
): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(AES_256_GCM, deriveKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}.${base64UrlEncode(tag)}`;
}

export function unsealJson<T>(
  token: string,
  secret: string,
): T {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid sealed token');
  const [ivB64, ciphertextB64, tagB64] = parts;

  const iv = base64UrlDecode(ivB64);
  const ciphertext = base64UrlDecode(ciphertextB64);
  const tag = base64UrlDecode(tagB64);

  const decipher = crypto.createDecipheriv(AES_256_GCM, deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

export function sealString(value: string, secret: string): string {
  return sealJson({ v: value }, secret);
}

export function unsealString(token: string, secret: string): string {
  return unsealJson<{ v: string }>(token, secret).v;
}
