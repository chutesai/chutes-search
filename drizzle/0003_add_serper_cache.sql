CREATE TABLE IF NOT EXISTS "serper_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"query_hash" text NOT NULL,
	"query" text NOT NULL,
	"results" jsonb NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "serper_cache_query_hash_idx" ON "serper_cache" ("query_hash");
