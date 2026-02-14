import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import db from '@/lib/db';
import { serperCache } from '@/lib/db/schema';
import { searchSerper } from '@/lib/serper';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Rate limiting for actual Serper API calls
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests

function hashQuery(query: string): string {
  return crypto.createHash('sha256').update(query).digest('hex');
}

/**
 * Search Serper with a 4-hour DB-backed cache.
 * Checks the database first; on miss, calls the Serper API, rate-limited,
 * and stores the result for future reuse.
 */
export async function cachedSearchSerper(query: string) {
  const queryHash = hashQuery(query);

  // Check DB cache
  try {
    const cached = await db.query.serperCache.findFirst({
      where: eq(serperCache.queryHash, queryHash),
    });

    if (cached) {
      const createdAt = new Date(cached.createdAt).getTime();
      if (Date.now() - createdAt < CACHE_TTL_MS) {
        console.log(`[serper-cache] HIT: ${query.substring(0, 80)}`);
        return cached.results as { results: any[]; suggestions: string[] };
      }
      // Expired entry — will be overwritten below
      console.log(`[serper-cache] EXPIRED: ${query.substring(0, 80)}`);
    }
  } catch (err) {
    console.warn('[serper-cache] DB read error, falling through to API:', err);
  }

  // Rate limit before calling the API
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest),
    );
  }
  lastRequestTime = Date.now();

  // Call Serper API
  let result;
  try {
    result = await searchSerper(query);
  } catch (err: any) {
    if (err?.response?.status === 429) {
      console.warn('[serper-cache] Serper rate limit hit, returning empty results');
      return { results: [], suggestions: [] };
    }
    throw err;
  }

  // Store in DB cache (upsert on queryHash unique index)
  try {
    await db
      .insert(serperCache)
      .values({
        queryHash,
        query,
        results: result,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: serperCache.queryHash,
        set: {
          results: result,
          query,
          createdAt: new Date().toISOString(),
        },
      })
      .execute();
    console.log(`[serper-cache] STORED: ${query.substring(0, 80)}`);
  } catch (err) {
    console.warn('[serper-cache] DB write error:', err);
  }

  return result;
}
