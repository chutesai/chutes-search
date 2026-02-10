-- Auth tables for Chutes IDP integration
-- These tables were missing from the original migration

CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text,
	`createdAt` text,
	`updatedAt` text
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`createdAt` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`accessTokenEnc` text NOT NULL,
	`refreshTokenEnc` text,
	`accessTokenExpiresAt` integer,
	`scope` text,
	`tokenType` text
);

--> statement-breakpoint

-- Also add sessionId and userId columns to chats if they don't exist
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a workaround
-- These columns may already exist from db:push

