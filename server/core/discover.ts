// AI mode in the search bar (M7, workflow 5, AC-015/034): NEW recipes, not
// ones already in the cookbook, from one of two sources the owner picks:
// "Write with AI" (Claude writes them; one quick call) or "Find on the web"
// (real pages via web search). The preference profile and favorites add
// context unless the owner turns preferences off for that search. Pure logic over the AI port. This
// module keeps it honest:
// - A web recipe must link to a page Anthropic's web tools actually returned
//   in this request (no invented sources), and says whether the page was read
//   or only seen in search results. A page already saved is shown as such.
// - A recipe Claude wrote itself is labeled as written by AI and untested
//   (owner decision D19, 2026-11-04).
// - Nothing is saved: either kind is saved only through the editor and the
//   owner's Save (D2).
import type { AiFailure, RecipeAi, WebSourceSeen } from "./ai";
import type { MarkerSignal } from "./markers";
import type { DigestSource } from "./preferences";
import { LIMITS } from "./recipes";

export const REQUEST_MAX = 500;
export const MAX_WEB = 4;
export type DiscoverSource = "write" | "web";
export const MAX_WRITTEN = 3;
const REASON_MAX = 400;
const MAX_TITLES = 400;
const MAX_FAVORITES = 25;

export interface WebDiscovery {
  kind: "web";
  title: string;
  url: string;
  /** Site or author name, falling back to the web address's host. */
  sourceName: string;
  reason: string;
  /** True when the AI read the page; false when it was only listed in search results. */
  pageRead: boolean;
  /** Set when this page is already a saved recipe. */
  savedRecipeId: string | null;
}

export interface WrittenDiscovery {
  kind: "written";
  title: string;
  description: string | null;
  yieldText: string | null;
  prepTime: string | null;
  cookTime: string | null;
  ingredients: { quantity: string; item: string }[];
  steps: string[];
  notes: string | null;
  reason: string;
}

export interface Discoveries {
  request: string;
  source: DiscoverSource;
  usedPreferences: boolean;
  web: WebDiscovery[];
  written: WrittenDiscovery[];
  note: string | null;
  /** Web suggestions dropped because their link wasn't among the pages the web tools returned. */
  droppedUnverified: number;
}

export type DiscoverOutcome = { ok: true; value: Discoveries } | { ok: false; reason: AiFailure | "invalid"; message: string };

export interface DiscoveryDeps {
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
const orNull = (value: string, max: number) => tidy(value, max) || null;

export function createDiscovery({ ai, digestSources, signals, profile, now }: DiscoveryDeps) {
  return {
    /** Admin-only: the caller checks access before calling (AC-066/067). */
    async discover(input: { request: unknown; source: DiscoverSource; usePreferences: boolean }): Promise<DiscoverOutcome> {
      const request = typeof input.request === "string" ? tidy(input.request, REQUEST_MAX + 1) : "";
      if (!request) return { ok: false, reason: "invalid", message: "Describe what you'd like to cook first." };
      if (request.length > REQUEST_MAX) return { ok: false, reason: "invalid", message: `Keep the request under ${REQUEST_MAX} characters.` };

      const { source, usePreferences } = input;
      const [sources, markerSignals, prefs] = await Promise.all([
        digestSources(),
        usePreferences ? signals() : Promise.resolve([]),
        usePreferences ? profile() : Promise.resolve(null),
      ]);
      const titleById = new Map(sources.map((s) => [s.id, s.title]));
      const favorites = markerSignals
        .filter((s) => (s.favorite || s.madeCount >= 2) && titleById.has(s.recipeId))
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.madeCount - a.madeCount)
        .slice(0, MAX_FAVORITES)
        .map((s) => titleById.get(s.recipeId)!);

      const result = await ai.discover({
        request,
        source,
        preferences: prefs ? prefs.preferences : null,
        rejected: prefs ? prefs.rejected : [],
        favorites,
        cookbookTitles: sources.slice(0, MAX_TITLES).map((s) => s.title),
        today: now().toISOString().slice(0, 10),
      });
      if (!result.ok) return result;

      const savedByUrl = new Map<string, string>();
      for (const s of sources) {
        const key = s.sourceUrl ? normalizeUrl(s.sourceUrl) : null;
        if (key) savedByUrl.set(key, s.id);
      }

      // Only links the web tools really returned count as sources (AC-034).
      const seen = new Map<string, WebSourceSeen>();
      for (const source of result.value.webSources) {
        const key = normalizeUrl(source.url);
        if (!key) continue;
        const prior = seen.get(key);
        seen.set(key, { url: source.url, title: source.title ?? prior?.title ?? null, read: source.read || Boolean(prior?.read) });
      }
      const web: WebDiscovery[] = [];
      let droppedUnverified = 0;
      for (const w of source === "web" ? result.value.web : []) {
        const key = normalizeUrl(w.url);
        const found = key ? seen.get(key) : undefined;
        if (!key || !found) {
          droppedUnverified += 1;
          continue;
        }
        if (web.some((x) => normalizeUrl(x.url) === key) || web.length >= MAX_WEB) continue;
        const host = new URL(found.url).hostname.replace(/^www\./, "");
        web.push({
          kind: "web",
          title: tidy(w.title, LIMITS.title) || found.title || host,
          url: found.url,
          sourceName: tidy(w.sourceName, LIMITS.shortText) || host,
          reason: tidy(w.reason, REASON_MAX),
          pageRead: found.read,
          savedRecipeId: savedByUrl.get(key) ?? null,
        });
      }

      const written: WrittenDiscovery[] = [];
      for (const r of source === "write" ? result.value.written : []) {
        const title = tidy(r.title, LIMITS.title);
        const ingredients = r.ingredients
          .map((i) => ({ quantity: tidy(i.quantity, LIMITS.shortText), item: tidy(i.item, LIMITS.shortText) }))
          .filter((i) => i.item)
          .slice(0, LIMITS.ingredients);
        const steps = r.steps.map((s) => s.trim()).filter(Boolean).slice(0, LIMITS.steps);
        // A written recipe must be a whole recipe: title, ingredients and steps.
        if (!title || ingredients.length === 0 || steps.length === 0 || written.length >= MAX_WRITTEN) continue;
        written.push({
          kind: "written",
          title,
          description: orNull(r.description, 1_000),
          yieldText: orNull(r.servings, LIMITS.shortText),
          prepTime: orNull(r.prepTime, LIMITS.shortText),
          cookTime: orNull(r.cookTime, LIMITS.shortText),
          ingredients,
          steps,
          notes: orNull(r.notes, 2_000),
          reason: tidy(r.reason, REASON_MAX),
        });
      }

      return { ok: true, value: { request, source, usedPreferences: usePreferences, web, written, note: result.value.note ? tidy(result.value.note, 600) : null, droppedUnverified } };
    },
  };
}

export type Discovery = ReturnType<typeof createDiscovery>;
