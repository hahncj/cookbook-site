-- Gives every existing entry a first history row from its current state, so
-- version history starts at today's content (entries saved before M3 had no
-- history). The snapshot shape matches server/core/history.ts.
INSERT OR IGNORE INTO `recipe_revisions` (`recipe_id`, `revision`, `snapshot`, `change_note`, `origin`, `restored_from`, `created_at`, `created_by`)
SELECT
	r.`id`,
	r.`revision`,
	json_object(
		'kind', r.`kind`,
		'title', r.`title`,
		'description', r.`description`,
		'notes', r.`notes`,
		'yieldText', r.`yield_text`,
		'prepTime', r.`prep_time`,
		'cookTime', r.`cook_time`,
		'ingredients', json(r.`ingredients`),
		'steps', json(r.`steps`),
		'sourceUrl', r.`source_url`,
		'sourceName', r.`source_name`,
		'tags', json((SELECT json_group_array(t.`name`) FROM `recipe_tags` rt JOIN `tags` t ON t.`id` = rt.`tag_id` WHERE rt.`recipe_id` = r.`id`)),
		'collections', json((SELECT json_group_array(json_object('id', c.`id`, 'name', c.`name`)) FROM `recipe_collections` rc JOIN `collections` c ON c.`id` = rc.`collection_id` WHERE rc.`recipe_id` = r.`id`)),
		'photos', json(r.`photos`)
	),
	NULL,
	'backfill',
	NULL,
	r.`updated_at`,
	r.`updated_by`
FROM `recipes` r;
