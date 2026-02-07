export function getChutesAuthSecret(): string {
  const secret =
    process.env.CHUTES_AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      'Missing auth secret. Set CHUTES_AUTH_SECRET (recommended) or NEXTAUTH_SECRET.',
    );
  }
  return secret;
}
