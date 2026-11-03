import { and, asc, count, desc, eq, exists, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Actor, CatalogRepository, CountedRef, ListQuery } from "../core/catalog";
import type { Entry, EntryInput, EntryOrigin, EntrySummary, NamedRef } from "../core/recipes";
import { ingredientSearchText } from "../core/recipes";
import { collections, recipeCollections, recipes, recipeTags, tags } from "../db/app-schema";
import { atomic, changesOf } from "./atomic";
import type { Database } from "./db";

type RecipeRow = typeof recipes.$inferSelect;

const PREVIEW_INGREDIENTS = 3;

function toSummary(row: RecipeRow, tagNames: string[]): EntrySummary {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    yieldText: row.yieldText,
    prepTime: row.prepTime,
    cookTime: row.cookTime,
    ingredientPreview: row.ingredients
      .map((ingredient) => ingredient.item)
      .filter((item) => item.length > 0)
      .slice(0, PREVIEW_INGREDIENTS),
    tags: tagNames,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function recipeValues(input: EntryInput) {
  return {
    kind: input.kind,
    title: input.title,
    description: input.description,
    notes: input.notes,
    yieldText: input.yieldText,
    prepTime: input.prepTime,
    cookTime: input.cookTime,
    ingredients: input.ingredients,
    steps: input.steps,
    searchIngredients: ingredientSearchText(input.ingredients),
    sourceUrl: input.sourceUrl,
    sourceName: input.sourceName,
  };
}

export function createCatalogRepository(db: Database, newId: () => string): CatalogRepository {
  /** Existing tags for the given names (case-insensitive) plus new rows for missing ones. */
  async function resolveTags(names: string[], now: Date) {
    if (names.length === 0) return { ids: [] as string[], missing: [] as (typeof tags.$inferInsert)[] };
    const lowered = names.map((name) => name.toLowerCase());
    const existing = await db
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(inArray(sql`lower(${tags.name})`, lowered));
    const byLower = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag.id]));
    const missing: (typeof tags.$inferInsert)[] = [];
    const ids = names.map((name) => {
      const found = byLower.get(name.toLowerCase());
      if (found) return found;
      const id = newId();
      missing.push({ id, name, createdAt: now });
      byLower.set(name.toLowerCase(), id);
      return id;
    });
    return { ids, missing };
  }

  /** Only collection ids that exist (stale form input is ignored rather than failing). */
  async function existingCollectionIds(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await db.select({ id: collections.id }).from(collections).where(inArray(collections.id, ids));
    const valid = new Set(rows.map((row) => row.id));
    return ids.filter((id) => valid.has(id));
  }

  async function tagNamesFor(recipeIds: string[]) {
    const map = new Map<string, string[]>();
    if (recipeIds.length === 0) return map;
    const rows = await db
      .select({ recipeId: recipeTags.recipeId, name: tags.name })
      .from(recipeTags)
      .innerJoin(tags, eq(tags.id, recipeTags.tagId))
      .where(inArray(recipeTags.recipeId, recipeIds))
      .orderBy(asc(tags.name));
    for (const row of rows) map.set(row.recipeId, [...(map.get(row.recipeId) ?? []), row.name]);
    return map;
  }

  return {
    async list(query: ListQuery) {
      const conditions: SQL[] = [isNull(recipes.deletedAt)];
      if (query.kind) conditions.push(eq(recipes.kind, query.kind));
      if (query.match) {
        conditions.push(sql`${recipes.id} in (select recipe_id from recipes_fts where recipes_fts match ${query.match})`);
      }
      if (query.tag) {
        conditions.push(
          sql`${recipes.id} in (select rt.recipe_id from recipe_tags rt join tags t on t.id = rt.tag_id where t.name = ${query.tag} collate nocase)`,
        );
      }
      if (query.collectionId) {
        conditions.push(sql`${recipes.id} in (select recipe_id from recipe_collections where collection_id = ${query.collectionId})`);
      }
      const where = and(...conditions);
      const [rows, totals] = await Promise.all([
        db.select().from(recipes).where(where).orderBy(desc(recipes.updatedAt)).limit(query.limit).offset(query.offset),
        db.select({ total: count() }).from(recipes).where(where),
      ]);
      const names = await tagNamesFor(rows.map((row) => row.id));
      return { items: rows.map((row) => toSummary(row, names.get(row.id) ?? [])), total: totals[0]?.total ?? 0 };
    },

    async get(id, options) {
      const conditions = [eq(recipes.id, id)];
      if (!options?.includeDeleted) conditions.push(isNull(recipes.deletedAt));
      const [row] = await db.select().from(recipes).where(and(...conditions)).limit(1);
      if (!row) return null;
      const [tagRows, collectionRows] = await Promise.all([
        db
          .select({ id: tags.id, name: tags.name })
          .from(recipeTags)
          .innerJoin(tags, eq(tags.id, recipeTags.tagId))
          .where(eq(recipeTags.recipeId, id))
          .orderBy(asc(tags.name)),
        db
          .select({ id: collections.id, name: collections.name })
          .from(recipeCollections)
          .innerJoin(collections, eq(collections.id, recipeCollections.collectionId))
          .where(eq(recipeCollections.recipeId, id))
          .orderBy(asc(collections.name)),
      ]);
      const entry: Entry = {
        id: row.id,
        kind: row.kind,
        title: row.title,
        description: row.description,
        notes: row.notes,
        yieldText: row.yieldText,
        prepTime: row.prepTime,
        cookTime: row.cookTime,
        ingredients: row.ingredients,
        steps: row.steps,
        sourceUrl: row.sourceUrl,
        sourceName: row.sourceName,
        origin: row.origin,
        revision: row.revision,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
        tags: tagRows,
        collections: collectionRows,
      };
      return entry;
    },

    async create(input, meta: { id: string; origin: EntryOrigin; now: Date; actor: Actor }) {
      const { ids: tagIds, missing } = await resolveTags(input.tags, meta.now);
      const collectionIds = await existingCollectionIds(input.collectionIds);
      await atomic(db, [
        () =>
          db.insert(recipes).values({
            id: meta.id,
            ...recipeValues(input),
            origin: meta.origin,
            revision: 1,
            createdAt: meta.now,
            updatedAt: meta.now,
            createdBy: meta.actor.userId,
            updatedBy: meta.actor.userId,
          }),
        ...missing.map((tag) => () => db.insert(tags).values(tag).onConflictDoNothing()),
        ...tagIds.map((tagId) => () => db.insert(recipeTags).values({ recipeId: meta.id, tagId }).onConflictDoNothing()),
        ...collectionIds.map(
          (collectionId) => () => db.insert(recipeCollections).values({ recipeId: meta.id, collectionId }).onConflictDoNothing(),
        ),
      ]);
    },

    async update(id, expectedRevision, input, meta) {
      const { ids: tagIds, missing } = await resolveTags(input.tags, meta.now);
      const collectionIds = await existingCollectionIds(input.collectionIds);
      const nextRevision = expectedRevision + 1;
      // Link changes only apply if THIS update won (revision, time and author all match).
      const applied = () => exists(db.select({ one: sql`1` }).from(recipes).where(wonUpdate));
      // Insert-from-select rows, produced only when THIS update won (see `applied`).
      const wonUpdate = and(
        eq(recipes.id, id),
        eq(recipes.revision, nextRevision),
        eq(recipes.updatedAt, meta.now),
        eq(recipes.updatedBy, meta.actor.userId),
      );
      const tagLink = (tagId: string) =>
        db
          .select({ recipeId: sql<string>`${id}`.as("recipe_id"), tagId: sql<string>`${tagId}`.as("tag_id") })
          .from(recipes)
          .where(wonUpdate);
      const collectionLink = (collectionId: string) =>
        db
          .select({ recipeId: sql<string>`${id}`.as("recipe_id"), collectionId: sql<string>`${collectionId}`.as("collection_id") })
          .from(recipes)
          .where(wonUpdate);

      const results = await atomic(db, [
        () =>
          db
            .update(recipes)
            .set({ ...recipeValues(input), revision: nextRevision, updatedAt: meta.now, updatedBy: meta.actor.userId })
            .where(and(eq(recipes.id, id), eq(recipes.revision, expectedRevision), isNull(recipes.deletedAt))),
        ...missing.map((tag) => () => db.insert(tags).values(tag).onConflictDoNothing()),
        () => db.delete(recipeTags).where(and(eq(recipeTags.recipeId, id), applied())),
        ...tagIds.map((tagId) => () => db.insert(recipeTags).select(tagLink(tagId)).onConflictDoNothing()),
        () => db.delete(recipeCollections).where(and(eq(recipeCollections.recipeId, id), applied())),
        ...collectionIds.map(
          (collectionId) => () => db.insert(recipeCollections).select(collectionLink(collectionId)).onConflictDoNothing(),
        ),
      ]);
      return changesOf(results[0]) > 0;
    },

    async setDeleted(id, deleted, meta) {
      const statement = deleted
        ? db
            .update(recipes)
            .set({ deletedAt: meta.now, deletedBy: meta.actor.userId })
            .where(and(eq(recipes.id, id), isNull(recipes.deletedAt)))
        : db
            .update(recipes)
            .set({ deletedAt: null, deletedBy: null, updatedAt: meta.now, updatedBy: meta.actor.userId })
            .where(and(eq(recipes.id, id), isNotNull(recipes.deletedAt)));
      const [result] = await atomic(db, [() => statement]);
      return changesOf(result) > 0;
    },

    async listDeleted() {
      const rows = await db.select().from(recipes).where(isNotNull(recipes.deletedAt)).orderBy(desc(recipes.deletedAt));
      const names = await tagNamesFor(rows.map((row) => row.id));
      return rows.map((row) => toSummary(row, names.get(row.id) ?? []));
    },

    async listTags(): Promise<CountedRef[]> {
      const rows = await db
        .select({ id: tags.id, name: tags.name, count: count(recipes.id) })
        .from(tags)
        .innerJoin(recipeTags, eq(recipeTags.tagId, tags.id))
        .innerJoin(recipes, and(eq(recipes.id, recipeTags.recipeId), isNull(recipes.deletedAt)))
        .groupBy(tags.id, tags.name)
        .orderBy(asc(sql`lower(${tags.name})`));
      return rows;
    },

    async listCollections(): Promise<CountedRef[]> {
      const rows = await db
        .select({ id: collections.id, name: collections.name, count: count(recipes.id) })
        .from(collections)
        .leftJoin(recipeCollections, eq(recipeCollections.collectionId, collections.id))
        .leftJoin(recipes, and(eq(recipes.id, recipeCollections.recipeId), isNull(recipes.deletedAt)))
        .groupBy(collections.id, collections.name)
        .orderBy(asc(sql`lower(${collections.name})`));
      return rows;
    },

    async createCollection(name, meta): Promise<NamedRef> {
      await atomic(db, [() => db.insert(collections).values({ id: meta.id, name, createdAt: meta.now }).onConflictDoNothing()]);
      const [row] = await db
        .select({ id: collections.id, name: collections.name })
        .from(collections)
        .where(sql`${collections.name} = ${name} collate nocase`)
        .limit(1);
      return row!;
    },
  };
}
