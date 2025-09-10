import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

// DATA_DIR is the directory in which db.sqlite resides. If not provided, default to <cwd>/data
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {}
const sqlite = new Database(path.join(DATA_DIR, 'db.sqlite'));
const db = drizzle(sqlite, {
  schema: schema,
});

export default db;
