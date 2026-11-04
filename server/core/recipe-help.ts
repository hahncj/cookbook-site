// "AI help" on a saved recipe (owner request 2026-11-04, D20): swaps for a
// missing ingredient, and changing the recipe ("make it vegetarian", "halve
// it", "use the air fryer"). Pure logic over the AI port. Rules:
// - Only for active recipes; admin-only callers check access first.
// - Swap amounts and changed recipes are the AI's suggestions, shown as such.
// - Nothing is saved here. A swap can be kept as a dated note; a change opens
//   the editor (a new version, with history) or becomes a new recipe, and the
//   owner's Save is the approval (D2).
import type { AiFailure, RecipeAi, RevisedRecipe, SubstituteOption } from "./ai";
import type { Entry } from "./recipes";
import { LIMITS } from "./recipes";

export const HAVE_MAX = 200;
export const CHANGE_REQUEST_MAX = 500;
export const MAX_OPTIONS = 4;
export const MAX_CHANGES = 10;

type Failure = { ok: false; reason: AiFailure | "invalid" | "not_found"; message: string };

export interface RecipeHelpDeps {
  ai: RecipeAi;
  getRecipe: (id: string) => Promise<Entry | null>;
  /** Preference statements that aren't rejected, owner-confirmed ones marked. */
  profile: () => Promise<{ preferences: { statement: string; confirmed: boolean }[] }>;
}

const tidy = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
const orNull = (value: string, max: number) => tidy(value, max) || null;

function forHelp(entry: Entry) {
  return {
    title: entry.title,
    yieldText: entry.yieldText,
    ingredients: entry.ingredients.filter((i) => i.item.trim()),
    steps: entry.steps,
    notes: entry.notes,
  };
}

async function profileLines(profile: RecipeHelpDeps["profile"]) {
  return (await profile()).preferences.map((p) => `${p.statement}${p.confirmed ? "" : " (inferred)"}`);
}

export function createRecipeHelp({ ai, getRecipe, profile }: RecipeHelpDeps) {
  return {
    /** Swaps for one ingredient of the recipe, optionally from what the cook has on hand. */
    async substitute(
      recipeId: string,
      input: { ingredient: unknown; have: unknown },
    ): Promise<{ ok: true; value: { ingredient: string; options: SubstituteOption[]; message: string | null } } | Failure> {
      const entry = await getRecipe(recipeId);
      if (!entry) return { ok: false, reason: "not_found", message: "That recipe wasn't found." };
      const ingredient = typeof input.ingredient === "string" ? tidy(input.ingredient, LIMITS.shortText) : "";
      if (!entry.ingredients.some((i) => tidy(i.item, LIMITS.shortText) === ingredient && ingredient))
        return { ok: false, reason: "invalid", message: "Choose one of this recipe's ingredients." };
      const have = typeof input.have === "string" ? tidy(input.have, HAVE_MAX + 1) : "";
      if (have.length > HAVE_MAX) return { ok: false, reason: "invalid", message: `Keep “what you have” under ${HAVE_MAX} characters.` };

      const result = await ai.suggestSubstitutes({ recipe: forHelp(entry), ingredient, have: have || null, preferences: await profileLines(profile) });
      if (!result.ok) return result;
      const options = result.value.options
        .map((o) => ({ use: tidy(o.use, LIMITS.shortText), amount: tidy(o.amount, LIMITS.shortText), how: tidy(o.how, 400), effect: tidy(o.effect, 300) }))
        .filter((o) => o.use)
        .slice(0, MAX_OPTIONS);
      return { ok: true, value: { ingredient, options, message: result.value.message ? tidy(result.value.message, 400) : null } };
    },

    /** A changed version of the recipe and what changed. */
    async revise(
      recipeId: string,
      input: { request: unknown },
    ): Promise<{ ok: true; value: { request: string; recipe: RevisedRecipe & { yieldText: string | null }; changes: string[]; message: string | null } } | Failure> {
      const entry = await getRecipe(recipeId);
      if (!entry) return { ok: false, reason: "not_found", message: "That recipe wasn't found." };
      const request = typeof input.request === "string" ? tidy(input.request, CHANGE_REQUEST_MAX + 1) : "";
      if (!request) return { ok: false, reason: "invalid", message: "Say how you'd like to change the recipe." };
      if (request.length > CHANGE_REQUEST_MAX) return { ok: false, reason: "invalid", message: `Keep the request under ${CHANGE_REQUEST_MAX} characters.` };

      const result = await ai.reviseRecipe({ recipe: forHelp(entry), request, preferences: await profileLines(profile) });
      if (!result.ok) return result;
      const r = result.value.recipe;
      const ingredients = r.ingredients
        .map((i) => ({ quantity: tidy(i.quantity, LIMITS.shortText), item: tidy(i.item, LIMITS.shortText) }))
        .filter((i) => i.item)
        .slice(0, LIMITS.ingredients);
      const steps = r.steps.map((s) => s.trim()).filter(Boolean).slice(0, LIMITS.steps);
      if (ingredients.length === 0 || steps.length === 0)
        return { ok: false, reason: "failed", message: result.value.message ?? "The AI couldn't change this recipe that way. Try asking differently." };
      const changes = result.value.changes.map((c) => tidy(c, 300)).filter(Boolean).slice(0, MAX_CHANGES);
      return {
        ok: true,
        value: {
          request,
          recipe: {
            title: tidy(r.title, LIMITS.title) || entry.title,
            description: tidy(r.description, 1_000),
            servings: tidy(r.servings, LIMITS.shortText),
            yieldText: orNull(r.servings, LIMITS.shortText),
            prepTime: tidy(r.prepTime, LIMITS.shortText),
            cookTime: tidy(r.cookTime, LIMITS.shortText),
            ingredients,
            steps,
            notes: tidy(r.notes, 2_000),
          },
          changes,
          message: result.value.message ? tidy(result.value.message, 400) : null,
        },
      };
    },
  };
}

export type RecipeHelp = ReturnType<typeof createRecipeHelp>;
