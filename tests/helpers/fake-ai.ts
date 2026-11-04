import type {
  AiResult,
  ImageInput,
  InferredPreference,
  IngredientSuggestion,
  ProfileInput,
  RecipeAi,
  RecipeComparison,
  RecommendationDraft,
  RecommendInput,
} from "../../server/core/ai";
import type { RecipeDraft } from "../../server/core/imports";

export const sampleDraft = (overrides: Partial<RecipeDraft> = {}): RecipeDraft => ({
  kind: "recipe",
  title: "Gochujang Butter Noodles",
  description: null,
  yieldText: "Serves 2",
  prepTime: null,
  cookTime: "10 min",
  ingredients: [
    { quantity: "200 g", item: "udon noodles" },
    { quantity: "1½ tbsp", item: "gochujang" },
    { quantity: "", item: "green onions" },
  ],
  steps: ["Boil the noodles.", "Toss with butter and gochujang."],
  notes: null,
  sourceUrl: null,
  sourceName: "ChatGPT",
  uncertain: [],
  otherRecipes: 0,
  ...overrides,
});

/** A scripted RecipeAi that records every call (to prove when AI is or isn't used). */
export class FakeAi implements RecipeAi {
  readonly configured = true;
  calls: { method: string; input: unknown }[] = [];
  extract: AiResult<RecipeDraft> = { ok: true, value: sampleDraft() };
  identify: AiResult<{ suggestions: IngredientSuggestion[]; message: string | null }> = {
    ok: true,
    value: {
      suggestions: [
        { name: "udon noodles", confidence: "high", note: null },
        { name: "sesame seeds", confidence: "low", note: "Could be breadcrumbs" },
      ],
      message: null,
    },
  };
  compare: AiResult<RecipeComparison> = { ok: true, value: { verdict: "same", explanation: "Same noodles and sauce." } };

  /** Set per test; ids come from the test's own recipes. */
  profile: AiResult<{ preferences: InferredPreference[]; note: string | null }> = { ok: true, value: { preferences: [], note: null } };
  recommendation: AiResult<RecommendationDraft> = { ok: true, value: { saved: [], web: [], note: null, webSources: [] } };

  async inferPreferences(input: ProfileInput) {
    this.calls.push({ method: "inferPreferences", input });
    return this.profile;
  }
  async recommend(input: RecommendInput) {
    this.calls.push({ method: "recommend", input });
    return this.recommendation;
  }
  async extractRecipe(input: { text?: string; image?: ImageInput; sourceUrl?: string | null }) {
    this.calls.push({ method: "extractRecipe", input });
    return this.extract;
  }
  async identifyIngredients(input: { images: ImageInput[]; description: string | null }) {
    this.calls.push({ method: "identifyIngredients", input });
    return this.identify;
  }
  async compareRecipes(a: string, b: string) {
    this.calls.push({ method: "compareRecipes", input: { a, b } });
    return this.compare;
  }
}
