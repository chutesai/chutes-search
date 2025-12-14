export function getChutesAuthSecret(): string {
  const secret =
    process.env.CHUTES_AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.CHUTES_API_KEY;
  if (!secret) {
    throw new Error(
      'Missing auth secret. Set CHUTES_AUTH_SECRET (recommended), NEXTAUTH_SECRET, or CHUTES_API_KEY.',
    );
  }
  return secret;
}
