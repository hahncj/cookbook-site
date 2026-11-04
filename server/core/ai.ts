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

export interface RecommendInput {
  /** The owner's request for this time only, e.g. "something quick". */
  question: string;
  recipes: RecipeDigest[];
  /** What the profile says, with who said it. */
  preferences: { statement: string; confirmed: boolean }[];
  /** Rejected inferences: don't assume these. */
  rejected: string[];
  includeWeb: boolean;
  /** ISO date, so "recently made" means something. */
  today: string;
}

/** A web page that Anthropic's web tools actually returned during the request. */
export interface WebSourceSeen {
  url: string;
  title: string | null;
  /** True when the page itself was fetched and read, not just listed in search results. */
  read: boolean;
}

export interface RecommendationDraft {
  saved: { recipeId: string; reason: string }[];
  web: { title: string; url: string; sourceName: string; reason: string }[];
  note: string | null;
  /** Collected by the adapter from tool results, never from the model's own text. */
  webSources: WebSourceSeen[];
}

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
  /** Ranks saved recipes and, when asked, finds new ones with web search (M7). */
  recommend(input: RecommendInput): Promise<AiResult<RecommendationDraft>>;
}

export const notConfigured: RecipeAi = {
  configured: false,
  extractRecipe: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  identifyIngredients: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  compareRecipes: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  inferPreferences: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  recommend: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
};

export const AI_NOT_CONFIGURED = "AI features aren't set up yet (no Anthropic API key). Everything else works normally.";
