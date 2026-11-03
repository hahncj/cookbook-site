import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Catalog entries: full recipes and incomplete food/drink ideas.
 * Ingredients and steps are stored as JSON (original quantity text is kept
 * verbatim). `searchIngredients` is plain text the full-text index reads.
 * Deleting sets `deletedAt`; rows are never removed (D6).
 */
export const recipes = sqliteTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["recipe", "idea"] }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    notes: text("notes"),
    yieldText: text("yield_text"),
    prepTime: text("prep_time"),
    cookTime: text("cook_time"),
    ingredients: text("ingredients", { mode: "json" }).$type<{ quantity: string; item: string }[]>().notNull(),
    steps: text("steps", { mode: "json" }).$type<string[]>().notNull(),
    /** Ordered photos shown with the entry (part of each revision's snapshot). */
    photos: text("photos", { mode: "json" }).$type<{ id: string; caption: string }[]>().notNull().default(sql`'[]'`),
    searchIngredients: text("search_ingredients").notNull().default(""),
    sourceUrl: text("source_url"),
    sourceName: text("source_name"),
    origin: text("origin", { enum: ["manual", "web", "image", "paste", "ai"] }).notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedBy: text("deleted_by"),
  },
  (t) => [index("recipes_updated_idx").on(t.deletedAt, t.updatedAt)],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("tags_name_unique").on(sql`${t.name} collate nocase`)],
);

export const recipeTags = sqliteTable(
  "recipe_tags",
  {
    recipeId: text("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.tagId] }), index("recipe_tags_tag_idx").on(t.tagId)],
);

export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("collections_name_unique").on(sql`${t.name} collate nocase`)],
);

export const recipeCollections = sqliteTable(
  "recipe_collections",
  {
    recipeId: text("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
    collectionId: text("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.collectionId] }), index("recipe_collections_collection_idx").on(t.collectionId)],
);

/**
 * Stored photo files (bytes live in the MediaStore under `photos/<id>.<ext>`
 * and `photos/<id>-thumb.<ext>`). Never deleted: a revision may still show it.
 * `recipeId` is set when a recipe that uses the photo is first saved; until
 * then only admins can view it.
 */
export const photos = sqliteTable(
  "photos",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id").references(() => recipes.id),
    ext: text("ext", { enum: ["jpg", "webp", "png"] }).notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    thumbBytes: integer("thumb_bytes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("photos_recipe_idx").on(t.recipeId)],
);

/** Immutable history: one full snapshot per saved version (AC-050). */
export const recipeRevisions = sqliteTable(
  "recipe_revisions",
  {
    recipeId: text("recipe_id").notNull().references(() => recipes.id),
    revision: integer("revision").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    changeNote: text("change_note"),
    origin: text("origin", { enum: ["create", "edit", "restore", "ai", "backfill"] }).notNull(),
    restoredFrom: integer("restored_from"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by"),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.revision] })],
);

/** Dated "notes & experiments" log (AC-051). Adding one does not create a version. */
export const recipeNotes = sqliteTable(
  "recipe_notes",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id").notNull().references(() => recipes.id),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("recipe_notes_recipe_idx").on(t.recipeId, t.createdAt)],
);
