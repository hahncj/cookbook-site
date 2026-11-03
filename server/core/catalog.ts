// Catalog operations and the repository port they depend on.
// Pure logic: the database adapter implements CatalogRepository.
import type { Entry, EntryInput, EntryKind, EntryOrigin, EntrySummary, NamedRef } from "./recipes";
import { buildSearchQuery } from "./recipes";

export interface ListQuery {
  /** FTS5 query built by buildSearchQuery, or null for no text search. */
  match: string | null;
  tag: string | null;
  collectionId: string | null;
  kind: EntryKind | null;
  limit: number;
  offset: number;
}

export interface CountedRef extends NamedRef {
  count: number;
}

export interface Actor {
  userId: string;
}

export interface CatalogRepository {
  list(query: ListQuery): Promise<{ items: EntrySummary[]; total: number }>;
  get(id: string, options?: { includeDeleted?: boolean }): Promise<Entry | null>;
  create(input: EntryInput, meta: { id: string; origin: EntryOrigin; now: Date; actor: Actor }): Promise<void>;
  /** Applies the update only if the stored revision equals `expectedRevision`. Returns false otherwise. */
  update(id: string, expectedRevision: number, input: EntryInput, meta: { now: Date; actor: Actor }): Promise<boolean>;
  setDeleted(id: string, deleted: boolean, meta: { now: Date; actor: Actor }): Promise<boolean>;
  listDeleted(): Promise<EntrySummary[]>;
  listTags(): Promise<CountedRef[]>;
  listCollections(): Promise<CountedRef[]>;
  createCollection(name: string, meta: { id: string; now: Date }): Promise<NamedRef>;
}

export interface CatalogDeps {
  repo: CatalogRepository;
  now: () => Date;
  newId: () => string;
}

export const PAGE_SIZE = 50;

export interface BrowseParams {
  q?: string | null;
  tag?: string | null;
  collection?: string | null;
  kind?: string | null;
  page?: number;
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "conflict" };

export function createCatalog({ repo, now, newId }: CatalogDeps) {
  return {
    async browse(params: BrowseParams) {
      const page = Math.max(1, Math.floor(params.page ?? 1));
      const kind = params.kind === "recipe" || params.kind === "idea" ? params.kind : null;
      const result = await repo.list({
        match: buildSearchQuery(params.q ?? ""),
        tag: params.tag?.trim() || null,
        collectionId: params.collection?.trim() || null,
        kind,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      return { ...result, page, pageCount: Math.max(1, Math.ceil(result.total / PAGE_SIZE)) };
    },

    /** Public read: inactive (deleted) entries are not visible. */
    get: (id: string) => repo.get(id),

    /** Admin read, including inactive entries (for the recovery view). */
    getIncludingDeleted: (id: string) => repo.get(id, { includeDeleted: true }),

    async create(input: EntryInput, actor: Actor, origin: EntryOrigin = "manual"): Promise<SaveResult> {
      const id = newId();
      await repo.create(input, { id, origin, now: now(), actor });
      return { ok: true, id };
    },

    async update(id: string, expectedRevision: number, input: EntryInput, actor: Actor): Promise<SaveResult> {
      const existing = await repo.get(id);
      if (!existing) return { ok: false, reason: "not_found" };
      if (existing.revision !== expectedRevision) return { ok: false, reason: "conflict" };
      const applied = await repo.update(id, expectedRevision, input, { now: now(), actor });
      return applied ? { ok: true, id } : { ok: false, reason: "conflict" };
    },

    remove: (id: string, actor: Actor) => repo.setDeleted(id, true, { now: now(), actor }),
    restore: (id: string, actor: Actor) => repo.setDeleted(id, false, { now: now(), actor }),
    listDeleted: () => repo.listDeleted(),
    listTags: () => repo.listTags(),
    listCollections: () => repo.listCollections(),

    async createCollection(name: string) {
      const trimmed = name.replace(/\s+/g, " ").trim();
      if (trimmed.length === 0 || trimmed.length > 80) return null;
      return repo.createCollection(trimmed, { id: newId(), now: now() });
    },
  };
}

export type Catalog = ReturnType<typeof createCatalog>;
