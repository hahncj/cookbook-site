import { and, asc, count, desc, eq, exists, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Actor, CatalogRepository, CountedRef, ListQuery, SaveMeta } from "../core/catalog";
import type { Revision, RevisionInfo, RevisionSnapshot } from "../core/history";
import { snapshotOf } from "../core/history";
import type { Entry, EntryInput, EntryOrigin, EntrySummary, NamedRef, PhotoRef } from "../core/recipes";
import { ingredientSearchText } from "../core/recipes";
import { collections, photos, recipeCollections, recipeNotes, recipeRevisions, recipes, recipeTags, tags } from "../db/app-schema";
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
    coverPhoto: row.photos[0] ?? null,
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
    photos: input.photos,
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

  /** Only collections that exist (stale form input or old versions are ignored rather than failing). */
  async function existingCollections(ids: string[]): Promise<NamedRef[]> {
    if (ids.length === 0) return [];
    const rows = await db.select({ id: collections.id, name: collections.name }).from(collections).where(inArray(collections.id, ids));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is NamedRef => Boolean(row));
  }

  /** Only photos that were uploaded (never trust ids from a form). */
  async function existingPhotos(list: PhotoRef[]): Promise<PhotoRef[]> {
    if (list.length === 0) return [];
    const rows = await db.select({ id: photos.id }).from(photos).where(inArray(photos.id, list.map((p) => p.id)));
    const valid = new Set(rows.map((row) => row.id));
    return list.filter((photo) => valid.has(photo.id));
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

  /** Normalizes input against what exists, and builds the version snapshot. */
  async function prepare(input: EntryInput, now: Date) {
    const [{ ids: tagIds, missing }, collectionRefs, photoRefs] = await Promise.all([
      resolveTags(input.tags, now),
      existingCollections(input.collectionIds),
      existingPhotos(input.photos),
    ]);
    const clean: EntryInput = { ...input, collectionIds: collectionRefs.map((c) => c.id), photos: photoRefs };
    return { clean, tagIds, missingTags: missing, snapshot: snapshotOf(clean, collectionRefs) };
  }

  const attachPhotos = (recipeId: string, list: PhotoRef[]) => () =>
    db
      .update(photos)
      .set({ recipeId })
      .where(and(inArray(photos.id, list.map((p) => p.id)), isNull(photos.recipeId)));

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
        photos: row.photos,
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

    async create(input, meta: SaveMeta & { id: string; origin: EntryOrigin }) {
      const { clean, tagIds, missingTags, snapshot } = await prepare(input, meta.now);
      await atomic(db, [
        () =>
          db.insert(recipes).values({
            id: meta.id,
            ...recipeValues(clean),
            origin: meta.origin,
            revision: 1,
            createdAt: meta.now,
            updatedAt: meta.now,
            createdBy: meta.actor.userId,
            updatedBy: meta.actor.userId,
          }),
        () =>
          db.insert(recipeRevisions).values({
            recipeId: meta.id,
            revision: 1,
            snapshot,
            changeNote: meta.changeNote,
            origin: meta.revisionOrigin,
            createdAt: meta.now,
            createdBy: meta.actor.userId,
          }),
        ...missingTags.map((tag) => () => db.insert(tags).values(tag).onConflictDoNothing()),
        ...tagIds.map((tagId) => () => db.insert(recipeTags).values({ recipeId: meta.id, tagId }).onConflictDoNothing()),
        ...clean.collectionIds.map(
          (collectionId) => () => db.insert(recipeCollections).values({ recipeId: meta.id, collectionId }).onConflictDoNothing(),
        ),
        ...(clean.photos.length ? [attachPhotos(meta.id, clean.photos)] : []),
      ]);
    },

    async update(id, expectedRevision, input, meta) {
      const { clean, tagIds, missingTags, snapshot } = await prepare(input, meta.now);
      const nextRevision = expectedRevision + 1;
      // Everything after the first statement applies only if THIS update won
      // (revision, time and author all match), so a losing concurrent update
      // cannot change links or add a version.
      const wonUpdate = and(
        eq(recipes.id, id),
        eq(recipes.revision, nextRevision),
        eq(recipes.updatedAt, meta.now),
        eq(recipes.updatedBy, meta.actor.userId),
      );
      const applied = () => exists(db.select({ one: sql`1` }).from(recipes).where(wonUpdate));
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
      const revisionRow = db
        .select({
          recipeId: sql<string>`${id}`.as("recipe_id"),
          revision: sql<number>`${nextRevision}`.as("revision"),
          snapshot: sql<string>`${JSON.stringify(snapshot)}`.as("snapshot"),
          changeNote: sql<string | null>`${meta.changeNote}`.as("change_note"),
          origin: sql<string>`${meta.revisionOrigin}`.as("origin"),
          restoredFrom: sql<number | null>`${meta.restoredFrom ?? null}`.as("restored_from"),
          createdAt: sql<number>`${meta.now.getTime()}`.as("created_at"),
          createdBy: sql<string>`${meta.actor.userId}`.as("created_by"),
        })
        .from(recipes)
        .where(wonUpdate);

      const results = await atomic(db, [
        () =>
          db
            .update(recipes)
            .set({ ...recipeValues(clean), revision: nextRevision, updatedAt: meta.now, updatedBy: meta.actor.userId })
            .where(and(eq(recipes.id, id), eq(recipes.revision, expectedRevision), isNull(recipes.deletedAt))),
        () => db.insert(recipeRevisions).select(revisionRow as never),
        ...missingTags.map((tag) => () => db.insert(tags).values(tag).onConflictDoNothing()),
        () => db.delete(recipeTags).where(and(eq(recipeTags.recipeId, id), applied())),
        ...tagIds.map((tagId) => () => db.insert(recipeTags).select(tagLink(tagId)).onConflictDoNothing()),
        () => db.delete(recipeCollections).where(and(eq(recipeCollections.recipeId, id), applied())),
        ...clean.collectionIds.map(
          (collectionId) => () => db.insert(recipeCollections).select(collectionLink(collectionId)).onConflictDoNothing(),
        ),
        ...(clean.photos.length ? [attachPhotos(id, clean.photos)] : []),
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
            .set({ deletedAt: null, deletedBy: null })
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
      return db
        .select({ id: tags.id, name: tags.name, count: count(recipes.id) })
        .from(tags)
        .innerJoin(recipeTags, eq(recipeTags.tagId, tags.id))
        .innerJoin(recipes, and(eq(recipes.id, recipeTags.recipeId), isNull(recipes.deletedAt)))
        .groupBy(tags.id, tags.name)
        .orderBy(asc(sql`lower(${tags.name})`));
    },

    async listCollections(): Promise<CountedRef[]> {
      return db
        .select({ id: collections.id, name: collections.name, count: count(recipes.id) })
        .from(collections)
        .leftJoin(recipeCollections, eq(recipeCollections.collectionId, collections.id))
        .leftJoin(recipes, and(eq(recipes.id, recipeCollections.recipeId), isNull(recipes.deletedAt)))
        .groupBy(collections.id, collections.name)
        .orderBy(asc(sql`lower(${collections.name})`));
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

    async listRevisions(id): Promise<RevisionInfo[]> {
      return db
        .select({
          revision: recipeRevisions.revision,
          origin: recipeRevisions.origin,
          changeNote: recipeRevisions.changeNote,
          restoredFrom: recipeRevisions.restoredFrom,
          createdAt: recipeRevisions.createdAt,
          createdBy: recipeRevisions.createdBy,
        })
        .from(recipeRevisions)
        .where(eq(recipeRevisions.recipeId, id))
        .orderBy(desc(recipeRevisions.revision));
    },

    async getRevision(id, revision): Promise<Revision | null> {
      const [row] = await db
        .select()
        .from(recipeRevisions)
        .where(and(eq(recipeRevisions.recipeId, id), eq(recipeRevisions.revision, revision)))
        .limit(1);
      if (!row) return null;
      const snapshot = (typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot) as RevisionSnapshot;
      return {
        revision: row.revision,
        origin: row.origin,
        changeNote: row.changeNote,
        restoredFrom: row.restoredFrom,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        snapshot: { ...snapshot, photos: snapshot.photos ?? [] },
      };
    },

    async addNote(recipeId, body, meta: { id: string; now: Date; actor: Actor }) {
      await atomic(db, [
        () => db.insert(recipeNotes).values({ id: meta.id, recipeId, body, createdAt: meta.now, createdBy: meta.actor.userId }),
      ]);
    },

    async listNotes(recipeId) {
      return db
        .select({ id: recipeNotes.id, body: recipeNotes.body, createdAt: recipeNotes.createdAt })
        .from(recipeNotes)
        .where(eq(recipeNotes.recipeId, recipeId))
        .orderBy(desc(recipeNotes.createdAt));
    },

    async similarCandidates(match, limit) {
      const rows = await db
        .select({ id: recipes.id, title: recipes.title, ingredients: recipes.ingredients })
        .from(recipes)
        .where(and(isNull(recipes.deletedAt), sql`${recipes.id} in (select recipe_id from recipes_fts where recipes_fts match ${match})`))
        .limit(limit);
      return rows.map((row) => ({ id: row.id, title: row.title, ingredients: row.ingredients.map((i) => i.item) }));
    },
  };
}
