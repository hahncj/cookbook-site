CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`target_recipe_id` text,
	`base_revision` integer,
	`proposed` text NOT NULL,
	`base_snapshot` text,
	`note` text,
	`credential_kind` text NOT NULL,
	`credential_id` text NOT NULL,
	`client_name` text NOT NULL,
	`submitted_by` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	`result_recipe_id` text,
	`result_revision` integer,
	`message` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_idempotency_unique` ON `submissions` (`credential_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `tool_revocations` (
	`client_id` text PRIMARY KEY NOT NULL,
	`revoked_at` integer NOT NULL,
	`revoked_by` text
);
