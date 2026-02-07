import { sql } from 'drizzle-orm';
import { text, integer, sqliteTable } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // OIDC "sub"
  username: text('username'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
});

export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  createdAt: text('createdAt').notNull(),
  expiresAt: integer('expiresAt', { mode: 'number' }).notNull(),
  accessTokenEnc: text('accessTokenEnc').notNull(),
  refreshTokenEnc: text('refreshTokenEnc'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'number' }),
  scope: text('scope'),
  tokenType: text('tokenType'),
});

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey(),
  content: text('content').notNull(),
  chatId: text('chatId').notNull(),
  messageId: text('messageId').notNull(),
  role: text('type', { enum: ['assistant', 'user'] }),
  metadata: text('metadata', {
    mode: 'json',
  }),
});

interface File {
  name: string;
  fileId: string;
}

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('createdAt').notNull(),
  focusMode: text('focusMode').notNull(),
  sessionId: text('sessionId'),
  userId: text('userId'),
  files: text('files', { mode: 'json' })
    .$type<File[]>()
    .default(sql`'[]'`),
});

// IP-based rate limiting for free search queries
export const ipSearchLogs = sqliteTable('ip_search_logs', {
  id: integer('id').primaryKey(),
  // NOTE: this stores a hashed client IP (not the raw address) for privacy.
  ipAddress: text('ip_address').notNull(),
  searchDate: text('search_date').notNull(), // Format: YYYY-MM-DD
  searchCount: integer('search_count').notNull().default(0),
});

// Aggregate counters for free-search throttling across all users/IPs.
export const freeSearchGlobalCounters = sqliteTable(
  'free_search_global_counters',
  {
    id: integer('id').primaryKey(),
    bucket: text('bucket', { enum: ['minute', 'hour'] }).notNull(),
    bucketStart: integer('bucket_start', { mode: 'number' }).notNull(),
    count: integer('count').notNull().default(0),
  },
);

// Anonymized application event logs (no user queries, no user identifiers).
export const eventLogs = sqliteTable('event_logs', {
  id: integer('id').primaryKey(),
  createdAt: text('createdAt').notNull(),
  level: text('level', { enum: ['debug', 'info', 'warn', 'error'] }).notNull(),
  event: text('event').notNull(),
  correlationId: text('correlationId'),
  metadata: text('metadata', { mode: 'json' }),
});
