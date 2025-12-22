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
const sqlite = new Database(path.join(DATA_DIR, 'db.sqlite'));
const db = drizzle(sqlite, {
  schema: schema,
});

export default db;
