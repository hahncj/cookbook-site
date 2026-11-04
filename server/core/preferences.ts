// The preference profile (M7, workflow 6, AC-016/017/035). Pure logic: the
// database adapter implements PreferencesRepository and the AI port does the
// inferring. Rules (requirements 03, "Preferences and recommendation
// behavior"):
// - Inferred items are suggestions with evidence (recipe ids), kept apart from
//   what the owner confirmed or wrote.
// - The profile changes only when the owner asks for a refresh (D9). A refresh
//   replaces unreviewed suggestions only; corrections always survive it.
// - A rejected or corrected inference is never suggested again automatically.
// - Allergies and medical or dietary restrictions are never inferred.
import type { Actor } from "./catalog";
import type { AiFailure, InferredPreference, RecipeAi, RecipeDigest } from "./ai";
import type { MarkerSignal } from "./markers";

export type PreferenceStatus = "suggested" | "confirmed" | "rejected";
export type PreferenceSource = "ai" | "owner";

export interface Preference {
  id: string;
  statement: string;
  /** The AI's original wording; null for owner-written items. */
  inferredStatement: string | null;
  source: PreferenceSource;
  status: PreferenceStatus;
  evidence: string[];
  confidence: "high" | "medium" | "low" | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileRefresh {
  id: string;
  recipeCount: number;
  note: string | null;
  createdAt: Date;
}

export interface PreferencesRepository {
  /** Every item, oldest first. */
  list(): Promise<Preference[]>;
  get(id: string): Promise<Preference | null>;
  insert(item: Preference, actor: Actor): Promise<void>;
  /** Changes wording and/or status. False when the item doesn't exist. */
  update(id: string, changes: { statement?: string; status?: PreferenceStatus }, meta: { now: Date; actor: Actor }): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** In one write: drops every unreviewed suggestion, inserts the new ones, and records the refresh. */
  replaceSuggestions(items: Preference[], refresh: ProfileRefresh, actor: Actor): Promise<void>;
  latestRefresh(): Promise<ProfileRefresh | null>;
}

/** What the catalog adapter supplies for building digests (active entries only, newest first). */
export interface DigestSource {
  id: string;
  kind: "recipe" | "idea";
  title: string;
  description: string | null;
  tags: string[];
  ingredients: string[];
  prepTime: string | null;
  cookTime: string | null;
  sourceUrl: string | null;
}

export const STATEMENT_MAX = 300;
/** Upper bound on recipes sent to the AI in one request, to keep cost predictable. */
export const MAX_DIGESTS = 300;
export const MAX_SUGGESTIONS = 12;
/** Below this many recipes the profile says it is a rough guess. */
export const SMALL_CATALOG = 8;

const DAY = 24 * 60 * 60 * 1000;
const STOP_WORDS = new Set(
  "a an and are as at be but by for from has have i in is it its likes like loves love of on or often our prefer prefers the they this to tend tends we with you your owner cook cooks".split(
    " ",
  ),
);

/** Health conditions are never inferred from which recipes exist (requirements 02, workflow 6). */
const MEDICAL = /allerg|intoleran|celiac|coeliac|gluten[- ]free|lactose|diabet|medical|health condition|kidney|heart disease|cholesterol|blood pressure|pregnan|dairy[- ]free|nut[- ]free|can't eat|cannot eat|must avoid/i;

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/our\b/g, "or") // flavour → flavor
      .split(/\s+/)
      .map((w) => w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")))
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  );
}

/** True when two statements say essentially the same thing (word overlap). */
export function sameStatement(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / (wa.size + wb.size - shared) >= 0.6 || shared / Math.min(wa.size, wb.size) >= 0.85;
}

export function cleanStatement(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text && text.length <= STATEMENT_MAX ? text : null;
}

/**
 * Turns catalog entries and feedback into what the AI reads, favorites, want
 * to try and made first, then newest, capped at MAX_DIGESTS.
 */
export function buildDigests(sources: DigestSource[], signals: MarkerSignal[], now: Date): RecipeDigest[] {
  const byId = new Map(signals.map((s) => [s.recipeId, s]));
  const weight = (id: string) => {
    const s = byId.get(id);
    return s ? (s.favorite ? 4 : 0) + (s.wantToTry ? 2 : 0) + (s.madeCount > 0 ? 1 : 0) : 0;
  };
  const ordered = sources
    .map((source, index) => ({ source, index, weight: weight(source.id) }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .slice(0, MAX_DIGESTS);
  return ordered.map(({ source }) => {
    const s = byId.get(source.id);
    return {
      id: source.id,
      kind: source.kind,
      title: source.title,
      description: source.description ? source.description.slice(0, 240) : null,
      tags: source.tags.slice(0, 10),
      ingredients: source.ingredients.filter(Boolean).slice(0, 15),
      prepTime: source.prepTime,
      cookTime: source.cookTime,
      feedback: s
        ? {
            favorite: s.favorite,
            wantToTry: s.wantToTry,
            madeCount: s.madeCount,
            lastMadeDaysAgo: s.lastMadeAt ? Math.max(0, Math.floor((now.getTime() - s.lastMadeAt.getTime()) / DAY)) : null,
          }
        : null,
    };
  });
}

export interface ProfileView {
  confirmed: Preference[];
  suggested: Preference[];
  rejected: Preference[];
  lastRefresh: ProfileRefresh | null;
}

export type RefreshOutcome =
  | { ok: true; added: number; kept: number; note: string | null }
  | { ok: false; reason: AiFailure | "empty_catalog"; message: string };

export interface PreferencesDeps {
  repo: PreferencesRepository;
  ai: RecipeAi;
  /** Active catalog entries for digests. */
  digestSources: () => Promise<DigestSource[]>;
  signals: () => Promise<MarkerSignal[]>;
  now: () => Date;
  newId: () => string;
}

export function createPreferences({ repo, ai, digestSources, signals, now, newId }: PreferencesDeps) {
  /** What the AI should know: everything not rejected, plus the rejected list to steer clear of. */
  async function forRecommendations() {
    const items = await repo.list();
    return {
      preferences: items.filter((p) => p.status !== "rejected").map((p) => ({ statement: p.statement, confirmed: p.status === "confirmed" })),
      rejected: items.filter((p) => p.status === "rejected").flatMap((p) => [p.statement, ...(p.inferredStatement && p.inferredStatement !== p.statement ? [p.inferredStatement] : [])]),
    };
  }

  return {
    /** Public read (D3). */
    async view(): Promise<ProfileView> {
      const [items, lastRefresh] = await Promise.all([repo.list(), repo.latestRefresh()]);
      return {
        confirmed: items.filter((p) => p.status === "confirmed"),
        suggested: items.filter((p) => p.status === "suggested"),
        rejected: items.filter((p) => p.status === "rejected"),
        lastRefresh,
      };
    },

    forRecommendations,

    /**
     * Asks the AI for a fresh set of suggestions (admin-only; the caller
     * checks first). Confirmed, owner-written and rejected items are kept and
     * passed along, and any new inference that repeats one of them is dropped,
     * so a correction is never undone by a refresh (AC-017, AC-035).
     */
    async refresh(actor: Actor): Promise<RefreshOutcome> {
      const [sources, markerSignals, items] = await Promise.all([digestSources(), signals(), repo.list()]);
      if (sources.length === 0) return { ok: false, reason: "empty_catalog", message: "Add some recipes first. Preferences are learned from the cookbook." };
      const time = now();
      const recipes = buildDigests(sources, markerSignals, time);
      const reviewed = items.filter((p) => p.status !== "suggested");
      const confirmed = reviewed.filter((p) => p.status === "confirmed");
      const rejected = reviewed.filter((p) => p.status === "rejected");
      const result = await ai.inferPreferences({
        recipes,
        confirmed: confirmed.map((p) => p.statement),
        rejected: rejected.flatMap((p) => [p.statement, ...(p.inferredStatement && p.inferredStatement !== p.statement ? [p.inferredStatement] : [])]),
      });
      if (!result.ok) return result;

      const known = new Set(recipes.map((r) => r.id));
      const blocked = reviewed.flatMap((p) => [p.statement, ...(p.inferredStatement ? [p.inferredStatement] : [])]);
      const fresh: Preference[] = [];
      for (const inferred of result.value.preferences) {
        const item = acceptInference(inferred, known);
        if (!item) continue;
        if (blocked.some((b) => sameStatement(b, item.statement))) continue;
        if (fresh.some((f) => sameStatement(f.statement, item.statement))) continue;
        // One millisecond apart, so the AI's order (most supported first) is kept.
        const createdAt = new Date(time.getTime() + fresh.length);
        fresh.push({
          id: newId(),
          statement: item.statement,
          inferredStatement: item.statement,
          source: "ai",
          status: "suggested",
          evidence: item.evidence,
          confidence: item.confidence,
          createdAt,
          updatedAt: createdAt,
        });
        if (fresh.length >= MAX_SUGGESTIONS) break;
      }

      const notes = [result.value.note?.trim() || null];
      if (sources.length < SMALL_CATALOG)
        notes.unshift(`The cookbook has only ${sources.length} recipe${sources.length === 1 ? "" : "s"}, so these are rough guesses.`);
      const note = notes.filter(Boolean).join(" ").slice(0, 600) || null;
      await repo.replaceSuggestions(fresh, { id: newId(), recipeCount: sources.length, note, createdAt: time }, actor);
      return { ok: true, added: fresh.length, kept: reviewed.length, note };
    },

    /** "Yes, that's right": a suggestion becomes confirmed. */
    async confirm(id: string, actor: Actor) {
      return (await repo.update(id, { status: "confirmed" }, { now: now(), actor })) ? "ok" : "not_found";
    },

    /** "Not true": kept as rejected so it doesn't come back (AC-035). */
    async reject(id: string, actor: Actor) {
      const item = await repo.get(id);
      if (!item) return "not_found";
      // An owner-written item is simply removed; there is no inference to block.
      if (item.source === "owner") return (await repo.remove(id)) ? "ok" : "not_found";
      return (await repo.update(id, { status: "rejected" }, { now: now(), actor })) ? "ok" : "not_found";
    },

    /** Corrected wording. The item becomes confirmed; the AI's original wording is kept to block repeats. */
    async edit(id: string, statement: unknown, actor: Actor): Promise<"ok" | "not_found" | "invalid"> {
      const text = cleanStatement(statement);
      if (!text) return "invalid";
      return (await repo.update(id, { statement: text, status: "confirmed" }, { now: now(), actor })) ? "ok" : "not_found";
    },

    /** The owner's own preference (always confirmed). */
    async add(statement: unknown, actor: Actor): Promise<"ok" | "invalid"> {
      const text = cleanStatement(statement);
      if (!text) return "invalid";
      const time = now();
      await repo.insert(
        { id: newId(), statement: text, inferredStatement: null, source: "owner", status: "confirmed", evidence: [], confidence: null, createdAt: time, updatedAt: time },
        actor,
      );
      return "ok";
    },

    /** "Allow again": forgets a rejection, so a later refresh may suggest it. */
    async forget(id: string): Promise<"ok" | "not_found"> {
      const item = await repo.get(id);
      if (!item || item.status !== "rejected") return "not_found";
      return (await repo.remove(id)) ? "ok" : "not_found";
    },
  };
}

/** Checks one AI inference: real evidence from this catalog, sensible length, nothing medical. */
function acceptInference(inferred: InferredPreference, known: Set<string>) {
  const statement = cleanStatement(inferred.statement);
  if (!statement || MEDICAL.test(statement)) return null;
  const evidence = [...new Set(inferred.evidence.filter((id) => known.has(id)))].slice(0, 8);
  if (evidence.length === 0) return null;
  const confidence = inferred.confidence === "high" || inferred.confidence === "medium" ? inferred.confidence : "low";
  return { statement, evidence, confidence } as const;
}

export type Preferences = ReturnType<typeof createPreferences>;
