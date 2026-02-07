import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

/**
 * Determine the data directory for SQLite storage.
 * - Uses DATA_DIR env var if set AND the directory exists (or can be created)
 * - Falls back to ./data during build time when persistent disk isn't mounted
 */
function getDataDir(): string {
  const envDataDir = process.env.DATA_DIR;
  const fallbackDir = path.join(process.cwd(), 'data');

  if (envDataDir) {
    try {
      // Check if the directory exists or can be created
      fs.mkdirSync(envDataDir, { recursive: true });
      return envDataDir;
    } catch {
      // During build time, the persistent disk may not be mounted
      // Fall back to local directory
      console.warn(
        `[db] Cannot access DATA_DIR=${envDataDir}, falling back to ${fallbackDir}`,
      );
    }
  }

  // Ensure fallback directory exists
  try {
    fs.mkdirSync(fallbackDir, { recursive: true });
  } catch {}

  return fallbackDir;
}

const DATA_DIR = getDataDir();
const sqliteRaw = new Database(path.join(DATA_DIR, 'db.sqlite'));

// Export the raw connection for transactional / atomic operations (server-side only).
export { sqliteRaw };

// Ensure all required tables exist at runtime
// This handles the case where the persistent disk DB doesn't have the latest schema
function ensureTablesExist() {
  try {
    // Create users table
    sqliteRaw.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT,
        createdAt TEXT,
        updatedAt TEXT
      )
    `);

    // Create auth_sessions table
    sqliteRaw.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        userId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        accessTokenEnc TEXT NOT NULL,
        refreshTokenEnc TEXT,
        accessTokenExpiresAt INTEGER,
        scope TEXT,
        tokenType TEXT
      )
    `);

    // Create chats table
    sqliteRaw.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        focusMode TEXT NOT NULL,
        sessionId TEXT,
        userId TEXT,
        files TEXT DEFAULT '[]'
      )
    `);

    // Create messages table
    sqliteRaw.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY NOT NULL,
        content TEXT NOT NULL,
        chatId TEXT NOT NULL,
        messageId TEXT NOT NULL,
        type TEXT,
        metadata TEXT
      )
    `);

    // Create ip_search_logs table
    sqliteRaw.exec(`
      CREATE TABLE IF NOT EXISTS ip_search_logs (
        id INTEGER PRIMARY KEY NOT NULL,
        ip_address TEXT NOT NULL,
        search_date TEXT NOT NULL,
        search_count INTEGER DEFAULT 0 NOT NULL
      )
    `);

    // Create index on ip_search_logs
    sqliteRaw.exec(`
      CREATE INDEX IF NOT EXISTS ip_date_idx ON ip_search_logs (ip_address, search_date)
    `);

    // Global counters for free-search throttling (aggregate across all IPs/users).
    sqliteRaw.exec(`
      CREATE TABLE IF NOT EXISTS free_search_global_counters (
        id INTEGER PRIMARY KEY NOT NULL,
        bucket TEXT NOT NULL,
        bucket_start INTEGER NOT NULL,
        count INTEGER DEFAULT 0 NOT NULL
      )
    `);
    sqliteRaw.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS free_search_global_counters_unique_idx
      ON free_search_global_counters (bucket, bucket_start)
    `);

    // Create anonymized event_logs table
    sqliteRaw.exec(`
      CREATE TABLE IF NOT EXISTS event_logs (
        id INTEGER PRIMARY KEY NOT NULL,
        createdAt TEXT NOT NULL,
        level TEXT NOT NULL,
        event TEXT NOT NULL,
        correlationId TEXT,
        metadata TEXT
      )
    `);

    sqliteRaw.exec(`
      CREATE INDEX IF NOT EXISTS event_logs_createdAt_idx ON event_logs (createdAt)
    `);
    sqliteRaw.exec(`
      CREATE INDEX IF NOT EXISTS event_logs_event_idx ON event_logs (event)
    `);
    sqliteRaw.exec(`
      CREATE INDEX IF NOT EXISTS event_logs_correlation_idx ON event_logs (correlationId)
    `);

    console.log('[db] Ensured all tables exist');
  } catch (err) {
    console.error('[db] Error ensuring tables exist:', err);
  }
}

ensureTablesExist();

const db = drizzle(sqliteRaw, {
  schema: schema,
});

export default db;
