import crypto from 'crypto';
import { pgClient } from '@/lib/db';
import { logEvent } from '@/lib/eventLog';

const FREE_SEARCHES_PER_DAY = 3;

// Global throttles (anonymous/free searches only), across all users/IPs.
const FREE_SEARCHES_GLOBAL_PER_MINUTE = 200;
const FREE_SEARCHES_GLOBAL_PER_HOUR = 6000;

type FreeSearchQuotaResult =
  | {
      allowed: true;
      used: number;
      remaining: number;
    }
  | {
      allowed: false;
      reason: 'ip_daily' | 'global_minute' | 'global_hour';
      used: number;
      remaining: number;
    };

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

function getTodayDate(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

function getMinuteBucketStart(nowMs: number) {
  return Math.floor(nowMs / 60000);
}

function getHourBucketStart(nowMs: number) {
  return Math.floor(nowMs / 3600000);
}

function getRateLimitHashSecret(): string {
  // Never fall back to CHUTES_API_KEY; we want CHUTES_API_KEY reserved for free searches only.
  return (
    process.env.CHUTES_RATE_LIMIT_SALT ||
    process.env.CHUTES_AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    'dev-insecure-salt'
  );
}

function hashClientIp(ip: string): string {
  const secret = getRateLimitHashSecret();
  // HMAC prevents trivial reversal if the DB is leaked.
  return crypto.createHmac('sha256', secret).update(ip).digest('hex');
}

function getClientIpKey(ipAddress: string) {
  // Store hashed IP for privacy.
  return hashClientIp(ipAddress);
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
  const ipKey = getClientIpKey(ipAddress);

  const rows = await pgClient`
    SELECT COALESCE(SUM(search_count), 0) AS used
    FROM ip_search_logs
    WHERE ip_address = ${ipKey} AND search_date = ${today}
  `;

  const used = Number(rows[0]?.used ?? 0);
  const remaining = Math.max(0, FREE_SEARCHES_PER_DAY - used);
  const allowed = used < FREE_SEARCHES_PER_DAY;

  return { allowed, remaining, used };
}

/**
 * Increment the search count for an IP address (best-effort).
 * Prefer consumeFreeSearchQuota() for atomic checks + global throttles.
 */
export async function incrementIpSearchCount(ipAddress: string): Promise<void> {
  const today = getTodayDate();
  const ipKey = getClientIpKey(ipAddress);

  const first = await pgClient`
    SELECT id
    FROM ip_search_logs
    WHERE ip_address = ${ipKey} AND search_date = ${today}
    ORDER BY id ASC
    LIMIT 1
  `;

  if (first[0]?.id) {
    await pgClient`
      UPDATE ip_search_logs SET search_count = search_count + 1 WHERE id = ${first[0].id}
    `;
    return;
  }

  await pgClient`
    INSERT INTO ip_search_logs (ip_address, search_date, search_count)
    VALUES (${ipKey}, ${today}, 1)
  `;
}

/**
 * Consume a free-search token for this request (best-effort, no transaction).
 *
 * Enforces:
 * - Per-IP daily quota (3/day)
 * - Global anonymous caps (200/min, 6000/hr)
 *
 * NOTE: Uses individual queries instead of a DB transaction because Neon HTTP
 * driver is stateless. Rate limiting is best-effort so small race windows
 * are acceptable.
 */
export async function consumeFreeSearchQuota(req: Request): Promise<FreeSearchQuotaResult> {
  const nowMs = Date.now();
  const today = getTodayDate();
  const ipKey = getClientIpKey(getClientIp(req));

  const minuteBucket = getMinuteBucketStart(nowMs);
  const hourBucket = getHourBucketStart(nowMs);

  // Check per-IP daily quota.
  const usedRows = await pgClient`
    SELECT COALESCE(SUM(search_count), 0) AS used
    FROM ip_search_logs
    WHERE ip_address = ${ipKey} AND search_date = ${today}
  `;
  const used = Number(usedRows[0]?.used ?? 0);

  if (used >= FREE_SEARCHES_PER_DAY) {
    logEvent({
      level: 'warn',
      event: 'free_search.rate_limited',
      metadata: { reason: 'ip_daily', used },
    });
    return { allowed: false, reason: 'ip_daily', used, remaining: 0 };
  }

  // Ensure global buckets exist.
  await pgClient`
    INSERT INTO free_search_global_counters (bucket, bucket_start, count)
    VALUES ('minute', ${minuteBucket}, 0)
    ON CONFLICT (bucket, bucket_start) DO NOTHING
  `;
  await pgClient`
    INSERT INTO free_search_global_counters (bucket, bucket_start, count)
    VALUES ('hour', ${hourBucket}, 0)
    ON CONFLICT (bucket, bucket_start) DO NOTHING
  `;

  // Check global limits.
  const minuteRows = await pgClient`
    SELECT count
    FROM free_search_global_counters
    WHERE bucket = 'minute' AND bucket_start = ${minuteBucket}
  `;
  const hourRows = await pgClient`
    SELECT count
    FROM free_search_global_counters
    WHERE bucket = 'hour' AND bucket_start = ${hourBucket}
  `;

  const minuteCount = Number(minuteRows[0]?.count ?? 0);
  const hourCount = Number(hourRows[0]?.count ?? 0);

  if (minuteCount >= FREE_SEARCHES_GLOBAL_PER_MINUTE) {
    logEvent({
      level: 'warn',
      event: 'free_search.rate_limited',
      metadata: { reason: 'global_minute', used },
    });
    return {
      allowed: false,
      reason: 'global_minute',
      used,
      remaining: FREE_SEARCHES_PER_DAY - used,
    };
  }

  if (hourCount >= FREE_SEARCHES_GLOBAL_PER_HOUR) {
    logEvent({
      level: 'warn',
      event: 'free_search.rate_limited',
      metadata: { reason: 'global_hour', used },
    });
    return {
      allowed: false,
      reason: 'global_hour',
      used,
      remaining: FREE_SEARCHES_PER_DAY - used,
    };
  }

  // Increment per-IP daily count.
  const first = await pgClient`
    SELECT id
    FROM ip_search_logs
    WHERE ip_address = ${ipKey} AND search_date = ${today}
    ORDER BY id ASC
    LIMIT 1
  `;

  if (first[0]?.id) {
    await pgClient`
      UPDATE ip_search_logs SET search_count = search_count + 1 WHERE id = ${first[0].id}
    `;
  } else {
    await pgClient`
      INSERT INTO ip_search_logs (ip_address, search_date, search_count)
      VALUES (${ipKey}, ${today}, 1)
    `;
  }

  // Increment global counters.
  await pgClient`
    UPDATE free_search_global_counters
    SET count = count + 1
    WHERE bucket = 'minute' AND bucket_start = ${minuteBucket}
  `;
  await pgClient`
    UPDATE free_search_global_counters
    SET count = count + 1
    WHERE bucket = 'hour' AND bucket_start = ${hourBucket}
  `;

  const nextUsed = used + 1;
  return {
    allowed: true,
    used: nextUsed,
    remaining: Math.max(0, FREE_SEARCHES_PER_DAY - nextUsed),
  };
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
