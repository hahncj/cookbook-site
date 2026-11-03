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
