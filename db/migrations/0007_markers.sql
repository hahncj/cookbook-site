CREATE TABLE `recipe_made` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`made_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipe_made_recipe_idx` ON `recipe_made` (`recipe_id`,`made_at`);--> statement-breakpoint
CREATE TABLE `recipe_markers` (
	`recipe_id` text PRIMARY KEY NOT NULL,
	`favorite_at` integer,
	`want_to_try_at` integer,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
