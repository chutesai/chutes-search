import db from '@/lib/db';
import { eventLogs } from '@/lib/db/schema';
import { lt } from 'drizzle-orm';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_RETENTION_DAYS = 30;

let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const anonymizeLogText = (value: string) => {
  // Replace URLs.
  let out = value.replace(/https?:\/\/[^\s)]+/gi, '<url>');
  // Replace IP addresses.
  out = out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>');
  // Replace common Chutes / OAuth tokens and secrets.
  out = out.replace(
    /\b(?:cpk|csk|cid|csc)_[A-Za-z0-9]+(?:\.[A-Za-z0-9]+){0,2}\b/g,
    '<redacted>',
  );
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, 'Bearer <redacted>');
  // Replace long hex blobs (often secrets / ids).
  out = out.replace(/\b[a-fA-F0-9]{32,}\b/g, '<hex>');
  // Replace UUIDs.
  out = out.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    '<uuid>',
  );
  // Replace hostnames/domains (best effort, keeps counts/timing readable).
  out = out.replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+){1,}\b/gi, '<host>');
  // Avoid unbounded growth.
  if (out.length > 800) out = out.slice(0, 800) + '...';
  return out;
};

export function logEvent(params: {
  level: LogLevel;
  event: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}) {
  const createdAt = new Date().toISOString();
  const metadata =
    params.metadata && Object.keys(params.metadata).length > 0
      ? params.metadata
      : undefined;

  void db
    .insert(eventLogs)
    .values({
      createdAt,
      level: params.level,
      event: params.event,
      correlationId: params.correlationId ?? null,
      metadata: metadata ?? null,
    })
    .execute()
    .catch((err) => {
      console.error('[eventLog] Failed to write event log', err);
    });

  maybeCleanup();
}

export function serializeError(err: unknown) {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: anonymizeLogText(err.message || ''),
      stack: err.stack ? anonymizeLogText(err.stack) : undefined,
    };
  }
  return { message: anonymizeLogText(String(err)) };
}

function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  const cutoff = new Date(
    Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  void db
    .delete(eventLogs)
    // ISO strings compare lexicographically in chronological order.
    .where(lt(eventLogs.createdAt, cutoff))
    .execute()
    .catch(() => {
      // Best-effort cleanup.
    });
}
