export const SEARCH_CANONICAL_HOST = 'search.chutes.ai';

const LEGACY_SEARCH_HOSTS = new Set([
  'chutes-search.com',
  'www.chutes-search.com',
]);

export function getCanonicalSearchHostRedirect(
  host: string | null | undefined,
): string | null {
  if (!host) return null;

  const normalizedHost = host.toLowerCase().split(':')[0];
  if (LEGACY_SEARCH_HOSTS.has(normalizedHost)) {
    return SEARCH_CANONICAL_HOST;
  }

  return null;
}
