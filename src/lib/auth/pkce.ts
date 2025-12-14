import crypto from 'crypto';
import { base64UrlEncode } from './base64url';

export type PkcePair = {
  codeVerifier: string;
  codeChallenge: string;
};

export function generatePkcePair(): PkcePair {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(
    crypto.createHash('sha256').update(codeVerifier).digest(),
  );
  return { codeVerifier, codeChallenge };
}

export function generateOAuthState(): string {
  return base64UrlEncode(crypto.randomBytes(16));
}

