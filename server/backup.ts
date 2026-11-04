import { count, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./adapters/db";
import type { MediaStore } from "./adapters/media";
import { atomic } from "./adapters/atomic";
import { cleanImage, IMAGE_CONTENT_TYPES, ImageError } from "./core/images";
import { collections, photos, preferenceRefreshes, preferences, recipeCollections, recipeMade, recipeMarkers, recipeNotes, recipeRevisions, recipes, recipeTags, tags } from "./db/app-schema";

/**
 * Full backups (D7, AC-041/053/061). The browser downloads the data JSON and
 * every photo and assembles the zip itself, so no server request does heavy
 * work (D16). Accounts, sessions and AI-tool connections are deliberately not
 * included: after a restore, admins sign in again and reconnect their tools.
 */
export const BACKUP_FORMAT = "cookbook-backup";
export const BACKUP_VERSION = 1;

/** Restore order respects references (recipes before links, revisions, notes and photos). */
export const TABLE_ORDER = [
  "tags",
  "collections",
  "recipes",
  "recipe_tags",
  "recipe_collections",
  "photos",
  "recipe_revisions",
  "recipe_notes",
  // Added in M6 (AC-061: feedback). Older backups simply have none.
  "recipe_markers",
  "recipe_made",
  // Added in M7: the preference profile and its refresh log. Older backups have none.
  "preferences",
  "preference_refreshes",
] as const;
export type BackupTable = (typeof TABLE_ORDER)[number];

const TABLES = {
  tags,
  collections,
  recipes,
  recipe_tags: recipeTags,
  recipe_collections: recipeCollections,
  photos,
  recipe_revisions: recipeRevisions,
  recipe_notes: recipeNotes,
  recipe_markers: recipeMarkers,
  recipe_made: recipeMade,
  preferences,
  preference_refreshes: preferenceRefreshes,
} as const;

const TIMESTAMP_KEYS = new Set(["createdAt", "updatedAt", "deletedAt", "favoriteAt", "wantToTryAt", "madeAt"]);

const id = z.string().min(1).max(64);
const ms = z.number().int().nonnegative();
const nullableText = (max = 20_000) => z.string().max(max).nullable();
const json = z.unknown();

const ROW_SCHEMAS: Record<BackupTable, z.ZodType> = {
  tags: z.object({ id, name: z.string().min(1).max(60), createdAt: ms }),
  collections: z.object({ id, name: z.string().min(1).max(80), description: nullableText(), createdAt: ms }),
  recipes: z.object({
    id,
    kind: z.enum(["recipe", "idea"]),
    title: z.string().min(1).max(200),
    description: nullableText(),
    notes: nullableText(),
    yieldText: nullableText(200),
    prepTime: nullableText(200),
    cookTime: nullableText(200),
    ingredients: z.array(z.object({ quantity: z.string(), item: z.string() })),
    steps: z.array(z.string()),
    photos: z.array(z.object({ id, caption: z.string() })),
    searchIngredients: z.string(),
    sourceUrl: nullableText(2_000),
    sourceName: nullableText(200),
    origin: z.enum(["manual", "web", "image", "paste", "ai"]),
    revision: z.number().int().positive(),
    createdAt: ms,
    updatedAt: ms,
    createdBy: nullableText(64),
    updatedBy: nullableText(64),
    deletedAt: ms.nullable(),
    deletedBy: nullableText(64),
  }),
  recipe_tags: z.object({ recipeId: id, tagId: id }),
  recipe_collections: z.object({ recipeId: id, collectionId: id }),
  photos: z.object({
    id,
    recipeId: id.nullable(),
    ext: z.enum(["jpg", "webp", "png"]),
    contentType: z.string().max(40),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().nonnegative(),
    thumbBytes: z.number().int().nonnegative(),
    createdAt: ms,
    createdBy: nullableText(64),
    // Added with E1; older backups have no credit.
    credit: nullableText(200).optional().default(null),
  }),
  recipe_revisions: z.object({
    recipeId: id,
    revision: z.number().int().positive(),
    snapshot: json,
    changeNote: nullableText(500),
    origin: z.enum(["create", "edit", "restore", "ai", "backfill"]),
    restoredFrom: z.number().int().positive().nullable(),
    createdAt: ms,
    createdBy: nullableText(64),
  }),
  recipe_notes: z.object({ id, recipeId: id, body: z.string().min(1).max(2_000), createdAt: ms, createdBy: nullableText(64) }),
  recipe_markers: z.object({ recipeId: id, favoriteAt: ms.nullable(), wantToTryAt: ms.nullable(), updatedAt: ms, updatedBy: nullableText(64) }),
  recipe_made: z.object({ id, recipeId: id, madeAt: ms, createdBy: nullableText(64) }),
  preferences: z.object({
    id,
    statement: z.string().min(1).max(300),
    inferredStatement: nullableText(300),
    source: z.enum(["ai", "owner"]),
    status: z.enum(["suggested", "confirmed", "rejected"]),
    evidence: z.array(id).max(50),
    confidence: z.enum(["high", "medium", "low"]).nullable(),
    createdAt: ms,
    updatedAt: ms,
    updatedBy: nullableText(64),
  }),
  preference_refreshes: z.object({ id, recipeCount: z.number().int().nonnegative(), note: nullableText(2_000), createdAt: ms, createdBy: nullableText(64) }),
};

export interface BackupData {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tables: Record<BackupTable, Record<string, unknown>[]>;
}

function toPlain(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = value instanceof Date ? value.getTime() : value;
  return out;
}

function fromPlain(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = TIMESTAMP_KEYS.has(key) && typeof value === "number" ? new Date(value) : value;
  }
  return out;
}

export async function exportBackupData(db: Database, now: Date): Promise<BackupData> {
  const tables = {} as BackupData["tables"];
  for (const name of TABLE_ORDER) {
    const rows = (await db.select().from(TABLES[name])) as Record<string, unknown>[];
    tables[name] = rows.map(toPlain);
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), tables };
}

/** Restore only runs into a cookbook with no catalog data, so it can never overwrite anything. */
export async function isCatalogEmpty(db: Database): Promise<boolean> {
  for (const table of [recipes, tags, collections, photos]) {
    const [row] = await db.select({ n: count() }).from(table);
    if ((row?.n ?? 0) > 0) return false;
  }
  return true;
}

/**
 * True when every recipe, tag, collection and photo already in the cookbook
 * comes from this backup, i.e. an interrupted restore of the same file. That
 * makes "run the restore again" safe without ever mixing in other data.
 */
export async function catalogContainedIn(
  db: Database,
  ids: { recipes?: unknown; tags?: unknown; collections?: unknown; photos?: unknown },
): Promise<boolean> {
  const checks = [
    { table: recipes, column: recipes.id, list: ids.recipes },
    { table: tags, column: tags.id, list: ids.tags },
    { table: collections, column: collections.id, list: ids.collections },
    { table: photos, column: photos.id, list: ids.photos },
  ];
  for (const { table, column, list } of checks) {
    const allowed = new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : []);
    const rows = await db.select({ id: column }).from(table);
    if (rows.some((row) => !allowed.has(row.id))) return false;
  }
  return true;
}

export const MAX_ROWS_PER_CHUNK = 200;

export type ImportResult = { ok: true; inserted: number } | { ok: false; message: string };

/** Inserts one chunk of rows. Re-sending a chunk is harmless (existing rows are kept). */
export async function importRows(db: Database, table: string, rows: unknown): Promise<ImportResult> {
  if (!(TABLE_ORDER as readonly string[]).includes(table)) return { ok: false, message: `Unknown table: ${table}` };
  if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_CHUNK) return { ok: false, message: "Invalid chunk" };
  const schema = ROW_SCHEMAS[table as BackupTable];
  const parsed: Record<string, unknown>[] = [];
  for (const [index, row] of rows.entries()) {
    const result = schema.safeParse(row);
    if (!result.success) return { ok: false, message: `Row ${index + 1} of ${table} is not valid: ${result.error.issues[0]?.message ?? "invalid"}` };
    parsed.push(fromPlain(result.data as Record<string, unknown>));
  }
  if (parsed.length === 0) return { ok: true, inserted: 0 };
  const target = TABLES[table as BackupTable];
  await atomic(
    db,
    parsed.map((row) => () => db.insert(target).values(row as never).onConflictDoNothing()),
  );
  return { ok: true, inserted: parsed.length };
}

const RESTORE_KEY = /^photos\/([0-9a-f-]{36})(-thumb)?\.(jpg|webp|png)$/i;

/** Stores one photo file from a backup. The photo's row must already be restored. */
export async function importPhotoFile(db: Database, media: MediaStore | null, key: string, body: Uint8Array): Promise<ImportResult> {
  if (!media) return { ok: false, message: "Photo storage is not configured." };
  const match = key.match(RESTORE_KEY);
  if (!match) return { ok: false, message: "Invalid photo name" };
  const [row] = await db
    .select({ id: photos.id, ext: photos.ext })
    .from(photos)
    .where(eq(photos.id, match[1]!.toLowerCase()))
    .limit(1);
  if (!row || row.ext !== match[3]!.toLowerCase()) return { ok: false, message: "Photo is not part of the restored data" };
  try {
    const clean = cleanImage(body);
    await media.put(key.toLowerCase(), clean.bytes, IMAGE_CONTENT_TYPES[clean.type]);
  } catch (error) {
    if (error instanceof ImageError) return { ok: false, message: error.message };
    throw error;
  }
  return { ok: true, inserted: 1 };
}
