import db from '@/lib/db';
import { ipSearchLogs } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

const FREE_SEARCHES_PER_DAY = 3;

/**
 * Get the client IP address from the request headers
 */
export function getClientIp(request: Request): string {
  const headers = request.headers;

  // Check various headers for the client IP (in order of priority)
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, the first one is the client
    const ips = forwardedFor.split(',').map((ip) => ip.trim());
    return ips[0];
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  const cfConnectingIp = headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // Fallback - in production this should rarely happen
  return 'unknown';
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Check if the IP has exceeded the free search limit for today
 * Returns: { allowed: boolean, remaining: number, used: number }
 */
export async function checkIpRateLimit(ipAddress: string): Promise<{
  allowed: boolean;
  remaining: number;
  used: number;
}> {
  const today = getTodayDate();

  const existing = await db.query.ipSearchLogs.findFirst({
    where: and(
      eq(ipSearchLogs.ipAddress, ipAddress),
      eq(ipSearchLogs.searchDate, today),
    ),
  });

  const used = existing?.searchCount ?? 0;
  const remaining = Math.max(0, FREE_SEARCHES_PER_DAY - used);
  const allowed = used < FREE_SEARCHES_PER_DAY;

  return { allowed, remaining, used };
}

/**
 * Increment the search count for an IP address
 */
export async function incrementIpSearchCount(ipAddress: string): Promise<void> {
  const today = getTodayDate();

  const existing = await db.query.ipSearchLogs.findFirst({
    where: and(
      eq(ipSearchLogs.ipAddress, ipAddress),
      eq(ipSearchLogs.searchDate, today),
    ),
  });

  if (existing) {
    await db
      .update(ipSearchLogs)
      .set({ searchCount: existing.searchCount + 1 })
      .where(
        and(
          eq(ipSearchLogs.ipAddress, ipAddress),
          eq(ipSearchLogs.searchDate, today),
        ),
      )
      .execute();
  } else {
    await db
      .insert(ipSearchLogs)
      .values({
        ipAddress,
        searchDate: today,
        searchCount: 1,
      })
      .execute();
  }
}

/**
 * Get rate limit info for displaying to the user
 */
export async function getRateLimitInfo(ipAddress: string): Promise<{
  freeSearchesTotal: number;
  freeSearchesRemaining: number;
  freeSearchesUsed: number;
}> {
  const { remaining, used } = await checkIpRateLimit(ipAddress);

  return {
    freeSearchesTotal: FREE_SEARCHES_PER_DAY,
    freeSearchesRemaining: remaining,
    freeSearchesUsed: used,
  };
}

