export function getRequestOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto =
    req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const host =
    req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

export function getSafeReturnTo(value: string | null | undefined): string {
  if (!value) return '/';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return '/';
}

