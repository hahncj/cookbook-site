// Catalog operations and the repository port they depend on.
// Pure logic: the database adapter implements CatalogRepository.
import type { Change, Revision, RevisionInfo, RevisionOrigin } from "./history";
import { diffSnapshots, snapshotOfEntry, snapshotToInput } from "./history";
import type { Entry, EntryInput, EntryKind, EntryOrigin, EntrySummary, NamedRef } from "./recipes";
import { buildSearchQuery } from "./recipes";
import type { DigestSource } from "./preferences";
import { anyKeywordQuery, findDuplicates, type DuplicateCandidate, type DuplicateInput, type DuplicateMatch } from "./duplicates";

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

export interface SaveMeta {
  now: Date;
  actor: Actor;
  changeNote: string | null;
  revisionOrigin: RevisionOrigin;
  restoredFrom?: number | null;
}

export interface ExperimentNote {
  id: string;
  body: string;
  createdAt: Date;
}

export interface CatalogRepository {
  /** Active entries, newest first, as material for preferences and recommendations (M7). */
  listDigestSources(limit: number): Promise<DigestSource[]>;
  /** Titles of the given active entries (missing or deleted ids are left out). */
  titles(ids: string[]): Promise<Map<string, string>>;
  list(query: ListQuery): Promise<{ items: EntrySummary[]; total: number }>;
  get(id: string, options?: { includeDeleted?: boolean }): Promise<Entry | null>;
  /** Creates the entry and its first version. */
  create(input: EntryInput, meta: SaveMeta & { id: string; origin: EntryOrigin }): Promise<void>;
  /** Applies the update and records a new version only if the stored revision equals `expectedRevision`. */
  update(id: string, expectedRevision: number, input: EntryInput, meta: SaveMeta): Promise<boolean>;
  setDeleted(id: string, deleted: boolean, meta: { now: Date; actor: Actor }): Promise<boolean>;
  listDeleted(): Promise<EntrySummary[]>;
  listTags(): Promise<CountedRef[]>;
  listCollections(): Promise<CountedRef[]>;
  createCollection(name: string, meta: { id: string; now: Date }): Promise<NamedRef>;
  listRevisions(id: string): Promise<RevisionInfo[]>;
  getRevision(id: string, revision: number): Promise<Revision | null>;
  addNote(recipeId: string, body: string, meta: { id: string; now: Date; actor: Actor }): Promise<void>;
  listNotes(recipeId: string): Promise<ExperimentNote[]>;
  /** Active entries whose text matches the FTS query (for duplicate checks). */
  similarCandidates(match: string, limit: number): Promise<DuplicateCandidate[]>;
}

export interface CatalogDeps {
  repo: CatalogRepository;
  now: () => Date;
  newId: () => string;
}

export const PAGE_SIZE = 50;
/** Entries read for preferences and recommendations; buildDigests then picks the most relevant. */
export const DIGEST_SOURCE_LIMIT = 1_000;
export const NOTE_MAX = 2_000;

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

function cleanNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed ? trimmed.slice(0, 500) : null;
}

export function createCatalog({ repo, now, newId }: CatalogDeps) {
  async function update(
    id: string,
    expectedRevision: number,
    input: EntryInput,
    actor: Actor,
    options: { changeNote?: string | null; origin?: RevisionOrigin; restoredFrom?: number | null } = {},
  ): Promise<SaveResult> {
    const existing = await repo.get(id);
    if (!existing) return { ok: false, reason: "not_found" };
    if (existing.revision !== expectedRevision) return { ok: false, reason: "conflict" };
    const applied = await repo.update(id, expectedRevision, input, {
      now: now(),
      actor,
      changeNote: cleanNote(options.changeNote),
      revisionOrigin: options.origin ?? "edit",
      restoredFrom: options.restoredFrom ?? null,
    });
    return applied ? { ok: true, id } : { ok: false, reason: "conflict" };
  }

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

    async create(
      input: EntryInput,
      actor: Actor,
      options: { origin?: EntryOrigin; changeNote?: string | null } = {},
    ): Promise<SaveResult> {
      const id = newId();
      await repo.create(input, {
        id,
        origin: options.origin ?? "manual",
        now: now(),
        actor,
        changeNote: cleanNote(options.changeNote),
        revisionOrigin: options.origin === "ai" ? "ai" : "create",
      });
      return { ok: true, id };
    },

    update,

    /**
     * Restores an earlier version by saving its content as a NEW version, so
     * nothing in between is lost (AC-050, AC-058). Fails with a conflict if the
     * entry changed since the viewer loaded it.
     */
    async restoreRevision(id: string, fromRevision: number, expectedCurrentRevision: number, actor: Actor): Promise<SaveResult> {
      const old = await repo.getRevision(id, fromRevision);
      if (!old) return { ok: false, reason: "not_found" };
      return update(id, expectedCurrentRevision, snapshotToInput(old.snapshot), actor, {
        origin: "restore",
        restoredFrom: fromRevision,
        changeNote: `Restored version ${fromRevision}`,
      });
    },

    history: (id: string) => repo.listRevisions(id),

    /** A version plus what changed from the version before it and to the current content. */
    async revisionDetail(id: string, revision: number) {
      const [entry, current, previous] = await Promise.all([
        repo.get(id),
        repo.getRevision(id, revision),
        revision > 1 ? repo.getRevision(id, revision - 1) : Promise.resolve(null),
      ]);
      if (!entry || !current) return null;
      const changesFromPrevious: Change[] | null = previous ? diffSnapshots(previous.snapshot, current.snapshot) : null;
      const changesToCurrent: Change[] = diffSnapshots(current.snapshot, snapshotOfEntry(entry));
      return { entry, revision: current, changesFromPrevious, changesToCurrent };
    },

    remove: (id: string, actor: Actor) => repo.setDeleted(id, true, { now: now(), actor }),
    restore: (id: string, actor: Actor) => repo.setDeleted(id, false, { now: now(), actor }),
    listDeleted: () => repo.listDeleted(),
    /** Material for preferences and recommendations (M7). */
    digestSources: () => repo.listDigestSources(DIGEST_SOURCE_LIMIT),
    titles: (ids: string[]) => repo.titles([...new Set(ids)]),
    listTags: () => repo.listTags(),
    listCollections: () => repo.listCollections(),

    async createCollection(name: string) {
      const trimmed = name.replace(/\s+/g, " ").trim();
      if (trimmed.length === 0 || trimmed.length > 80) return null;
      return repo.createCollection(trimmed, { id: newId(), now: now() });
    },

    async addNote(recipeId: string, body: string, actor: Actor): Promise<"ok" | "empty" | "too_long" | "not_found"> {
      const text = body.trim();
      if (!text) return "empty";
      if (text.length > NOTE_MAX) return "too_long";
      if (!(await repo.get(recipeId))) return "not_found";
      await repo.addNote(recipeId, text, { id: newId(), now: now(), actor });
      return "ok";
    },

    listNotes: (recipeId: string) => repo.listNotes(recipeId),

    /** Free duplicate check (D8): word overlap only, no AI. Never changes anything (AC-057). */
    async findSimilar(draft: DuplicateInput, options: { excludeId?: string | null } = {}): Promise<DuplicateMatch[]> {
      const match = anyKeywordQuery(draft.title);
      if (!match) return [];
      const candidates = (await repo.similarCandidates(match, 40)).filter((c) => c.id !== options.excludeId);
      return findDuplicates(draft, candidates);
    },
  };
}

export type Catalog = ReturnType<typeof createCatalog>;
