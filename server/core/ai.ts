// The AI port (M5): what the cookbook asks of an AI model. The Claude
// implementation lives in server/ai/; tests use a fake. All results are
// suggestions for the admin to review; nothing is saved automatically.
import type { RecipeDraft } from "./imports";

export interface ImageInput {
  data: Uint8Array;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface IngredientSuggestion {
  name: string;
  /** "low"/"medium" are shown as unsure. */
  confidence: "high" | "medium" | "low";
  note: string | null;
}

export interface RecipeComparison {
  verdict: "same" | "variation" | "different";
  explanation: string;
}

/**
 * One catalog entry as the AI sees it for preferences and recommendations
 * (M7). Only public recipe content plus the owner's feedback markers.
 */
export interface RecipeDigest {
  id: string;
  kind: "recipe" | "idea";
  title: string;
  description: string | null;
  tags: string[];
  /** Ingredient names only, no amounts. */
  ingredients: string[];
  prepTime: string | null;
  cookTime: string | null;
  /** Feedback markers (M6). Null when the recipe has none. */
  feedback: { favorite: boolean; wantToTry: boolean; madeCount: number; lastMadeDaysAgo: number | null } | null;
}

export interface InferredPreference {
  statement: string;
  confidence: "high" | "medium" | "low";
  /** Ids of recipes that support it. */
  evidence: string[];
}

export interface ProfileInput {
  recipes: RecipeDigest[];
  /** Owner-confirmed or owner-written preferences: keep, don't repeat. */
  confirmed: string[];
  /** Rejected by the owner: never suggest these again (AC-035). */
  rejected: string[];
}

export interface DiscoverInput {
  /** What the owner typed in the search bar with AI mode on. */
  request: string;
  /** "write": Claude writes recipes (one quick call). "web": find real pages with web search. */
  source: "write" | "web";
  /** The preference profile, with who said it; null when the owner turned preferences off for this search. */
  preferences: { statement: string; confirmed: boolean }[] | null;
  /** Rejected inferences: don't assume these. */
  rejected: string[];
  /** Titles of favorite and often-made recipes, as taste hints. */
  favorites: string[];
  /** Every saved title, so results are new rather than repeats. */
  cookbookTitles: string[];
  /** Results already shown for this request ("More"): web addresses, or titles of written recipes. */
  exclude: string[];
  /** ISO date. */
  today: string;
}

/** A web page that Anthropic's web tools actually returned during the request. */
export interface WebSourceSeen {
  url: string;
  title: string | null;
  /** True when the page itself was fetched and read, not just listed in search results. */
  read: boolean;
}

/** A recipe Claude wrote itself (owner-approved 2026-11-04, D19): labeled, untested, saved only through the editor. */
export interface WrittenRecipe {
  title: string;
  description: string;
  servings: string;
  prepTime: string;
  cookTime: string;
  ingredients: { quantity: string; item: string }[];
  steps: string[];
  notes: string;
  reason: string;
}

export interface DiscoveryDraft {
  web: { title: string; url: string; sourceName: string; reason: string }[];
  written: WrittenRecipe[];
  note: string | null;
  /** Collected by the adapter from tool results, never from the model's own text. */
  webSources: WebSourceSeen[];
}

/** One saved recipe as the AI sees it for "AI help" on the recipe page. */
export interface RecipeForHelp {
  title: string;
  yieldText: string | null;
  ingredients: { quantity: string; item: string }[];
  steps: string[];
  notes: string | null;
}

/** A swap for a missing ingredient. Amounts are the AI's suggestion (D20). */
export interface SubstituteOption {
  use: string;
  amount: string;
  how: string;
  effect: string;
}

/** A changed version of a saved recipe (D20): reviewed in the editor before anything is saved. */
export type RevisedRecipe = Omit<WrittenRecipe, "reason">;

export type AiFailure = "not_configured" | "no_recipe" | "refused" | "failed";

export type AiResult<T> = { ok: true; value: T } | { ok: false; reason: AiFailure; message: string };

export interface RecipeAi {
  readonly configured: boolean;
  /** Extracts one recipe from pasted text, page text, or a photo/screenshot. Never invents missing details. */
  extractRecipe(input: { text?: string; image?: ImageInput; sourceUrl?: string | null }): Promise<AiResult<RecipeDraft>>;
  /** Suggests ingredient names from photos and/or a description. Never quantities (AC-046). */
  identifyIngredients(input: { images: ImageInput[]; description: string | null }): Promise<AiResult<{ suggestions: IngredientSuggestion[]; message: string | null }>>;
  /** Judges whether two recipes are the same dish (for duplicate checks, on request only). */
  compareRecipes(a: string, b: string): Promise<AiResult<RecipeComparison>>;
  /** Infers likely preferences from the catalog (M7, on request only). */
  inferPreferences(input: ProfileInput): Promise<AiResult<{ preferences: InferredPreference[]; note: string | null }>>;
  /** Writes new recipes, or finds new ones on the web, optionally guided by the preference profile (M7). */
  discover(input: DiscoverInput): Promise<AiResult<DiscoveryDraft>>;
  /** Swaps for a missing ingredient in a saved recipe (D20). */
  suggestSubstitutes(input: {
    recipe: RecipeForHelp;
    ingredient: string;
    have: string | null;
    preferences: string[];
  }): Promise<AiResult<{ options: SubstituteOption[]; message: string | null }>>;
  /** A changed version of a saved recipe, with a plain list of what changed (D20). */
  reviseRecipe(input: {
    recipe: RecipeForHelp;
    request: string;
    preferences: string[];
  }): Promise<AiResult<{ recipe: RevisedRecipe; changes: string[]; message: string | null }>>;
}

export const notConfigured: RecipeAi = {
  configured: false,
  extractRecipe: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  identifyIngredients: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  compareRecipes: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  inferPreferences: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  discover: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  suggestSubstitutes: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  reviseRecipe: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
};

export const AI_NOT_CONFIGURED = "AI features aren't set up yet (no Anthropic API key). Everything else works normally.";
