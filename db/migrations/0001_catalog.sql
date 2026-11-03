CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_name_unique` ON `collections` ("name" collate nocase);--> statement-breakpoint
CREATE TABLE `recipe_collections` (
	`recipe_id` text NOT NULL,
	`collection_id` text NOT NULL,
	PRIMARY KEY(`recipe_id`, `collection_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_collections_collection_idx` ON `recipe_collections` (`collection_id`);--> statement-breakpoint
CREATE TABLE `recipe_tags` (
	`recipe_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`recipe_id`, `tag_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_tags_tag_idx` ON `recipe_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`notes` text,
	`yield_text` text,
	`prep_time` text,
	`cook_time` text,
	`ingredients` text NOT NULL,
	`steps` text NOT NULL,
	`search_ingredients` text DEFAULT '' NOT NULL,
	`source_url` text,
	`source_name` text,
	`origin` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_by` text
);
--> statement-breakpoint
CREATE INDEX `recipes_updated_idx` ON `recipes` (`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` ("name" collate nocase);