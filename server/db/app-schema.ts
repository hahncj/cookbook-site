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
    /** Credit line for found stock or web photos (E1), e.g. "Photo: Jane Doe / Pixabay". Null for uploads. */
    credit: text("credit"),
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

/** Simple key/value settings (e.g. "approval_required", default on). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  updatedBy: text("updated_by"),
});

/**
 * Additions and updates sent by external AI tools (M4). With approval on they
 * wait here (never public, AC-070) until an admin approves or rejects them.
 * `proposed` is the complete entry as it would be saved; for updates
 * `baseSnapshot` is the entry at `baseRevision`, for showing the differences.
 */
export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["create", "update"] }).notNull(),
    status: text("status", { enum: ["pending", "applied", "rejected", "conflict"] }).notNull(),
    targetRecipeId: text("target_recipe_id"),
    baseRevision: integer("base_revision"),
    proposed: text("proposed", { mode: "json" }).notNull(),
    baseSnapshot: text("base_snapshot", { mode: "json" }),
    note: text("note"),
    credentialKind: text("credential_kind", { enum: ["oauth", "api_key"] }).notNull(),
    credentialId: text("credential_id").notNull(),
    clientName: text("client_name").notNull(),
    submittedBy: text("submitted_by").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    decidedBy: text("decided_by"),
    resultRecipeId: text("result_recipe_id"),
    resultRevision: integer("result_revision"),
    message: text("message"),
  },
  (t) => [
    uniqueIndex("submissions_idempotency_unique").on(t.credentialId, t.idempotencyKey),
    index("submissions_status_idx").on(t.status, t.createdAt),
  ],
);

/** Personal API keys for tools that don't use OAuth (scripts, Claude Code). Only a hash is stored. */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("api_keys_hash_unique").on(t.keyHash)],
);

/**
 * When an admin disconnects an OAuth-connected tool, access tokens issued
 * before this time are refused (they are self-contained JWTs). Reconnecting
 * issues new tokens, which are accepted.
 */
export const toolRevocations = sqliteTable("tool_revocations", {
  clientId: text("client_id").primaryKey(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }).notNull(),
  revokedBy: text("revoked_by"),
});
