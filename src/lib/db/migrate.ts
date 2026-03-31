import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'path';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}

const sql = postgres(databaseUrl, { prepare: false });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
} finally {
  await sql.end();
}
