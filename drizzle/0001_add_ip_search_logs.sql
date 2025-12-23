-- IP-based rate limiting table for tracking free search queries
CREATE TABLE IF NOT EXISTS `ip_search_logs` (
	`id` integer PRIMARY KEY NOT NULL,
	`ip_address` text NOT NULL,
	`search_date` text NOT NULL,
	`search_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ip_date_idx` ON `ip_search_logs` (`ip_address`, `search_date`);


