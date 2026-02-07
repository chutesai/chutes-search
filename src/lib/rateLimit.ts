import crypto from 'crypto';
import { sqliteRaw } from '@/lib/db';
import { logEvent } from '@/lib/eventLog';

const FREE_SEARCHES_PER_DAY = 3;

// Global throttles (anonymous/free searches only), across all users/IPs.
const FREE_SEARCHES_GLOBAL_PER_MINUTE = 100;
const FREE_SEARCHES_GLOBAL_PER_HOUR = 3000;

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

  const row = sqliteRaw
    .prepare(
      `SELECT COALESCE(SUM(search_count), 0) AS used
       FROM ip_search_logs
       WHERE ip_address = ? AND search_date = ?`,
    )
    .get(ipKey, today) as { used?: number } | undefined;

  const used = row?.used ?? 0;
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

  const first = sqliteRaw
    .prepare(
      `SELECT id
       FROM ip_search_logs
       WHERE ip_address = ? AND search_date = ?
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get(ipKey, today) as { id: number } | undefined;

  if (first?.id) {
    sqliteRaw
      .prepare(`UPDATE ip_search_logs SET search_count = search_count + 1 WHERE id = ?`)
      .run(first.id);
    return;
  }

  sqliteRaw
    .prepare(
      `INSERT INTO ip_search_logs (ip_address, search_date, search_count)
       VALUES (?, ?, 1)`,
    )
    .run(ipKey, today);
}

/**
 * Atomically consume a free-search token for this request.
 *
 * Enforces:
 * - Per-IP daily quota (3/day)
 * - Global anonymous caps (100/min, 3000/hr)
 *
 * IMPORTANT:
 * - This does not log user queries or IP addresses.
 * - This stores hashed IPs in the DB for privacy.
 */
export async function consumeFreeSearchQuota(req: Request): Promise<FreeSearchQuotaResult> {
  const nowMs = Date.now();
  const today = getTodayDate();
  const ipKey = getClientIpKey(getClientIp(req));

  const minuteBucket = getMinuteBucketStart(nowMs);
  const hourBucket = getHourBucketStart(nowMs);

  const tx = sqliteRaw.transaction((): FreeSearchQuotaResult => {
    const usedRow = sqliteRaw
      .prepare(
        `SELECT COALESCE(SUM(search_count), 0) AS used
         FROM ip_search_logs
         WHERE ip_address = ? AND search_date = ?`,
      )
      .get(ipKey, today) as { used?: number } | undefined;

    const used = usedRow?.used ?? 0;
    if (used >= FREE_SEARCHES_PER_DAY) {
      return {
        allowed: false,
        reason: 'ip_daily',
        used,
        remaining: 0,
      };
    }

    // Ensure global buckets exist.
    sqliteRaw
      .prepare(
        `INSERT OR IGNORE INTO free_search_global_counters (bucket, bucket_start, count)
         VALUES ('minute', ?, 0)`,
      )
      .run(minuteBucket);
    sqliteRaw
      .prepare(
        `INSERT OR IGNORE INTO free_search_global_counters (bucket, bucket_start, count)
         VALUES ('hour', ?, 0)`,
      )
      .run(hourBucket);

    const minuteRow = sqliteRaw
      .prepare(
        `SELECT count
         FROM free_search_global_counters
         WHERE bucket = 'minute' AND bucket_start = ?`,
      )
      .get(minuteBucket) as { count?: number } | undefined;

    const hourRow = sqliteRaw
      .prepare(
        `SELECT count
         FROM free_search_global_counters
         WHERE bucket = 'hour' AND bucket_start = ?`,
      )
      .get(hourBucket) as { count?: number } | undefined;

    const minuteCount = minuteRow?.count ?? 0;
    const hourCount = hourRow?.count ?? 0;

    if (minuteCount >= FREE_SEARCHES_GLOBAL_PER_MINUTE) {
      return {
        allowed: false,
        reason: 'global_minute',
        used,
        remaining: FREE_SEARCHES_PER_DAY - used,
      };
    }

    if (hourCount >= FREE_SEARCHES_GLOBAL_PER_HOUR) {
      return {
        allowed: false,
        reason: 'global_hour',
        used,
        remaining: FREE_SEARCHES_PER_DAY - used,
      };
    }

    // Increment per-IP daily count (update one row to avoid duplicate amplification).
    const first = sqliteRaw
      .prepare(
        `SELECT id
         FROM ip_search_logs
         WHERE ip_address = ? AND search_date = ?
         ORDER BY id ASC
         LIMIT 1`,
      )
      .get(ipKey, today) as { id: number } | undefined;

    if (first?.id) {
      sqliteRaw
        .prepare(`UPDATE ip_search_logs SET search_count = search_count + 1 WHERE id = ?`)
        .run(first.id);
    } else {
      sqliteRaw
        .prepare(
          `INSERT INTO ip_search_logs (ip_address, search_date, search_count)
           VALUES (?, ?, 1)`,
        )
        .run(ipKey, today);
    }

    // Increment global counters.
    sqliteRaw
      .prepare(
        `UPDATE free_search_global_counters
         SET count = count + 1
         WHERE bucket = 'minute' AND bucket_start = ?`,
      )
      .run(minuteBucket);
    sqliteRaw
      .prepare(
        `UPDATE free_search_global_counters
         SET count = count + 1
         WHERE bucket = 'hour' AND bucket_start = ?`,
      )
      .run(hourBucket);

    const nextUsed = used + 1;
    return {
      allowed: true,
      used: nextUsed,
      remaining: Math.max(0, FREE_SEARCHES_PER_DAY - nextUsed),
    };
  });

  const result = tx();
  if (!result.allowed) {
    // Log *only* aggregate failure reasons and counts (no IP/user/query).
    logEvent({
      level: 'warn',
      event: 'free_search.rate_limited',
      metadata: {
        reason: result.reason,
        used: result.used,
      },
    });
  }

  return result;
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

