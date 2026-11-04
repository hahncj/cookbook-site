CREATE TABLE `preference_refreshes` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_count` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`statement` text NOT NULL,
	`inferred_statement` text,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`confidence` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE INDEX `preferences_status_idx` ON `preferences` (`status`,`created_at`);