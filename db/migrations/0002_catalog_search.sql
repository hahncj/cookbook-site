-- Full-text search over catalog entries (SQLite FTS5; works on D1 and on the
-- Node host's SQLite). Kept in sync by triggers so no code path can forget.
-- Deleted (inactive) entries stay indexed; queries filter them out.
CREATE VIRTUAL TABLE `recipes_fts` USING fts5(
	`recipe_id` UNINDEXED,
	`title`,
	`description`,
	`notes`,
	`ingredients`,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
--> statement-breakpoint
CREATE TRIGGER `recipes_fts_insert` AFTER INSERT ON `recipes` BEGIN
	INSERT INTO `recipes_fts` (`recipe_id`, `title`, `description`, `notes`, `ingredients`)
	VALUES (new.`id`, new.`title`, coalesce(new.`description`, ''), coalesce(new.`notes`, ''), new.`search_ingredients`);
END;
--> statement-breakpoint
CREATE TRIGGER `recipes_fts_update` AFTER UPDATE ON `recipes` BEGIN
	DELETE FROM `recipes_fts` WHERE `recipe_id` = old.`id`;
	INSERT INTO `recipes_fts` (`recipe_id`, `title`, `description`, `notes`, `ingredients`)
	VALUES (new.`id`, new.`title`, coalesce(new.`description`, ''), coalesce(new.`notes`, ''), new.`search_ingredients`);
END;
--> statement-breakpoint
CREATE TRIGGER `recipes_fts_delete` AFTER DELETE ON `recipes` BEGIN
	DELETE FROM `recipes_fts` WHERE `recipe_id` = old.`id`;
END;
