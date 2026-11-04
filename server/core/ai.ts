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
}

export const notConfigured: RecipeAi = {
  configured: false,
  extractRecipe: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  identifyIngredients: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
  compareRecipes: async () => ({ ok: false, reason: "not_configured", message: AI_NOT_CONFIGURED }),
};

export const AI_NOT_CONFIGURED = "AI features aren't set up yet (no Anthropic API key). Everything else works normally.";
