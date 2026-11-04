// "Ask AI for suggestions" (M7, workflow 5, AC-015/034). Pure logic over the
// AI port. The AI ranks saved recipes using the preference profile and the
// owner's Favorite / Want to try / Made markers, and may look on the web. This
// module keeps it honest:
// - A saved suggestion must be a real, active recipe from this cookbook.
// - A web discovery must link to a page Anthropic's web tools actually
//   returned in this request (no invented sources), and says whether the page
//   was read or only seen in search results.
// - Nothing is saved: a web discovery is saved only through the normal editor
//   and the owner's Save (D2).
import type { AiFailure, RecipeAi, WebSourceSeen } from "./ai";
import type { MarkerSignal } from "./markers";
import { buildDigests, type DigestSource } from "./preferences";

export const QUESTION_MAX = 500;
export const MAX_SAVED = 8;
export const MAX_WEB = 5;
const REASON_MAX = 400;

export interface SavedSuggestion {
  kind: "saved";
  recipeId: string;
  title: string;
  reason: string;
  feedback: { favorite: boolean; wantToTry: boolean; madeCount: number } | null;
}

export interface WebSuggestion {
  kind: "web";
  title: string;
  url: string;
  /** Site or author name as shown, falling back to the web address's host. */
  sourceName: string;
  reason: string;
  /** True when the AI read the page; false when it was only listed in search results. */
  pageRead: boolean;
}

export interface Recommendations {
  question: string;
  includeWeb: boolean;
  saved: SavedSuggestion[];
  web: WebSuggestion[];
  note: string | null;
  /** Web discoveries dropped because their link wasn't among the pages the web tools returned. */
  droppedUnverified: number;
}

export type RecommendOutcome = { ok: true; value: Recommendations } | { ok: false; reason: AiFailure | "invalid" | "empty_catalog"; message: string };

export interface RecommenderDeps {
  ai: RecipeAi;
  digestSources: () => Promise<DigestSource[]>;
  signals: () => Promise<MarkerSignal[]>;
  profile: () => Promise<{ preferences: { statement: string; confirmed: boolean }[]; rejected: string[] }>;
  now: () => Date;
}

/** Normalizes a web address for comparison: http(s) only (treated alike), no "www.", fragment or trailing slash. */
export function normalizeUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  return url.toString().replace(/\/$/, "");
}

const tidy = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

export function createRecommender({ ai, digestSources, signals, profile, now }: RecommenderDeps) {
  return {
    /** Admin-only: the caller checks access before calling (AC-066/067). */
    async ask(input: { question: unknown; includeWeb: boolean }): Promise<RecommendOutcome> {
      const question = typeof input.question === "string" ? tidy(input.question, QUESTION_MAX + 1) : "";
      if (question.length > QUESTION_MAX) return { ok: false, reason: "invalid", message: `Keep the request under ${QUESTION_MAX} characters.` };
      const asked = question || "What should I cook next?";

      const [sources, markerSignals, prefs] = await Promise.all([digestSources(), signals(), profile()]);
      if (sources.length === 0 && !input.includeWeb)
        return { ok: false, reason: "empty_catalog", message: "The cookbook is empty. Add some recipes, or turn on web suggestions." };
      const time = now();
      const recipes = buildDigests(sources, markerSignals, time);

      const result = await ai.recommend({
        question: asked,
        recipes,
        preferences: prefs.preferences,
        rejected: prefs.rejected,
        includeWeb: input.includeWeb,
        today: time.toISOString().slice(0, 10),
      });
      if (!result.ok) return result;

      const byId = new Map(sources.map((s) => [s.id, s]));
      const digestById = new Map(recipes.map((r) => [r.id, r]));
      const savedBySourceUrl = new Map<string, DigestSource>();
      for (const s of sources) {
        const key = s.sourceUrl ? normalizeUrl(s.sourceUrl) : null;
        if (key) savedBySourceUrl.set(key, s);
      }

      const saved: SavedSuggestion[] = [];
      const addSaved = (recipeId: string, reason: string) => {
        const source = byId.get(recipeId);
        if (!source || saved.some((s) => s.recipeId === recipeId) || saved.length >= MAX_SAVED) return;
        const feedback = digestById.get(recipeId)?.feedback ?? null;
        saved.push({
          kind: "saved",
          recipeId,
          title: source.title,
          reason: tidy(reason, REASON_MAX),
          feedback: feedback ? { favorite: feedback.favorite, wantToTry: feedback.wantToTry, madeCount: feedback.madeCount } : null,
        });
      };
      for (const s of result.value.saved) addSaved(s.recipeId, s.reason);

      // Only links the web tools really returned count as sources (AC-034).
      const seen = new Map<string, WebSourceSeen>();
      for (const source of result.value.webSources) {
        const key = normalizeUrl(source.url);
        if (!key) continue;
        const prior = seen.get(key);
        seen.set(key, { url: source.url, title: source.title ?? prior?.title ?? null, read: source.read || Boolean(prior?.read) });
      }
      const web: WebSuggestion[] = [];
      let droppedUnverified = 0;
      if (input.includeWeb) {
        for (const w of result.value.web) {
          const key = normalizeUrl(w.url);
          const found = key ? seen.get(key) : undefined;
          if (!key || !found) {
            droppedUnverified += 1;
            continue;
          }
          // Already in the cookbook: show it as a saved recipe instead.
          const existing = savedBySourceUrl.get(key);
          if (existing) {
            addSaved(existing.id, w.reason);
            continue;
          }
          if (web.some((x) => normalizeUrl(x.url) === key) || web.length >= MAX_WEB) continue;
          const title = tidy(w.title, 200) || found.title || new URL(found.url).hostname;
          web.push({
            kind: "web",
            title,
            url: found.url,
            sourceName: tidy(w.sourceName, 120) || new URL(found.url).hostname.replace(/^www\./, ""),
            reason: tidy(w.reason, REASON_MAX),
            pageRead: found.read,
          });
        }
      }

      return {
        ok: true,
        value: {
          question: asked,
          includeWeb: input.includeWeb,
          saved,
          web,
          note: result.value.note ? tidy(result.value.note, 600) : null,
          droppedUnverified,
        },
      };
    },
  };
}

export type Recommender = ReturnType<typeof createRecommender>;
