import { sql } from 'drizzle-orm';
import {
  text,
  integer,
  serial,
  jsonb,
  pgTable,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(), // OIDC "sub"
  username: text('username'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});

export const authSessions = pgTable('auth_sessions', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  createdAt: text('createdAt').notNull(),
  expiresAt: integer('expiresAt').notNull(),
  accessTokenEnc: text('accessTokenEnc').notNull(),
  refreshTokenEnc: text('refreshTokenEnc'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt'),
  scope: text('scope'),
  tokenType: text('tokenType'),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  chatId: text('chatId').notNull(),
  messageId: text('messageId').notNull(),
  role: text('type'),
  metadata: jsonb('metadata'),
});

interface File {
  name: string;
  fileId: string;
}

export const chats = pgTable('chats', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('createdAt').notNull(),
  focusMode: text('focusMode').notNull(),
  sessionId: text('sessionId'),
  userId: text('userId'),
  files: jsonb('files')
    .$type<File[]>()
    .default(sql`'[]'::jsonb`),
});

// IP-based rate limiting for free search queries
export const ipSearchLogs = pgTable(
  'ip_search_logs',
  {
    id: serial('id').primaryKey(),
    // NOTE: this stores a hashed client IP (not the raw address) for privacy.
    ipAddress: text('ip_address').notNull(),
    searchDate: text('search_date').notNull(), // Format: YYYY-MM-DD
    searchCount: integer('search_count').notNull().default(0),
  },
  (table) => [index('ip_date_idx').on(table.ipAddress, table.searchDate)],
);

// Aggregate counters for free-search throttling across all users/IPs.
export const freeSearchGlobalCounters = pgTable(
  'free_search_global_counters',
  {
    id: serial('id').primaryKey(),
    bucket: text('bucket').notNull(),
    bucketStart: integer('bucket_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('free_search_global_counters_unique_idx').on(
      table.bucket,
      table.bucketStart,
    ),
  ],
);

// Anonymized application event logs (no user queries, no user identifiers).
export const eventLogs = pgTable(
  'event_logs',
  {
    id: serial('id').primaryKey(),
    createdAt: text('createdAt').notNull(),
    level: text('level').notNull(),
    event: text('event').notNull(),
    correlationId: text('correlationId'),
    metadata: jsonb('metadata'),
  },
  (table) => [
    index('event_logs_createdAt_idx').on(table.createdAt),
    index('event_logs_event_idx').on(table.event),
    index('event_logs_correlation_idx').on(table.correlationId),
  ],
);
