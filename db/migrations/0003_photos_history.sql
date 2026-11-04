CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text,
	`ext` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer NOT NULL,
	`thumb_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `photos_recipe_idx` ON `photos` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipe_notes_recipe_idx` ON `recipe_notes` (`recipe_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `recipe_revisions` (
	`recipe_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`change_note` text,
	`origin` text NOT NULL,
	`restored_from` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	PRIMARY KEY(`recipe_id`, `revision`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `recipes` ADD `photos` text DEFAULT '[]' NOT NULL;