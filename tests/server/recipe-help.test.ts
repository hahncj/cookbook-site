import { beforeEach, describe, expect, it } from "vitest";
import { createRouterContext } from "../../app/context";
import { action as helpAction } from "../../app/routes/api.ai.recipe-help";
import { action as editAction } from "../../app/routes/recipe-edit";
import { action as importAction } from "../../app/routes/recipe-import";
import { action as recipeAction, loader as recipeLoader } from "../../app/routes/recipe";
import type { Services } from "../../server/app";
import { validateEntry } from "../../server/core/recipes";
import { FakeAi } from "../helpers/fake-ai";
import { ADMIN_EMAIL, BASE_URL, createTestServices, sessionCookieFor } from "../helpers/services";

// "AI help" on a recipe (D20): swaps for a missing ingredient and changing the
// recipe. Admin-only before any Claude call (AC-066/067); nothing is saved
// until the owner's Save (D2), and a change saves as a new version.

let services: Services;
let ai: FakeAi;
let admin: string;
let recipeId: string;
const actor = { userId: "admin" };

beforeEach(async () => {
  ai = new FakeAi();
  services = createTestServices({ ai });
  admin = await sessionCookieFor(services, ADMIN_EMAIL);
  const valid = validateEntry({
    kind: "recipe",
    title: "Beef Chili",
    yieldText: "Serves 4",
    notes: "Better the next day.",
    ingredients: [
      { quantity: "1 lb", item: "ground beef" },
      { quantity: "1 cup", item: "sour cream" },
    ],
    steps: ["Brown the beef.", "Simmer 30 minutes."],
    tags: [],
    collectionIds: [],
  });
  if (!valid.ok) throw new Error();
  const created = await services.catalog.create(valid.value, actor);
  if (!created.ok) throw new Error();
  recipeId = created.id;
});

const args = (request: Request, params: Record<string, string> = {}) => ({ request, params, context: createRouterContext(services) }) as never;

const json = (body: unknown, cookie?: string) =>
  new Request(`${BASE_URL}/api/ai/recipe-help`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const post = (path: string, fields: Record<string, string>, cookie?: string) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request(`${BASE_URL}${path}`, { method: "POST", body, headers: cookie ? { Cookie: cookie } : {} });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose bodies in assertions
async function run(promise: Promise<unknown>): Promise<{ status: number; body: any }> {
  let result: unknown;
  try {
    result = await promise;
  } catch (thrown) {
    result = thrown;
  }
  if (result instanceof Response) {
    const text = await result.text();
    try {
      return { status: result.status, body: JSON.parse(text) };
    } catch {
      return { status: result.status, body: text };
    }
  }
  const wrapped = result as { type?: string; data?: unknown; init?: { status?: number } };
  if (wrapped && wrapped.type === "DataWithResponseInit") return { status: wrapped.init?.status ?? 200, body: wrapped.data };
  return { status: 200, body: result };
}

const revised = {
  title: "Lentil Chili",
  description: "",
  servings: "Serves 4",
  prepTime: "",
  cookTime: "",
  ingredients: [
    { quantity: "2 cans", item: "lentils" },
    { quantity: "1 cup", item: "sour cream" },
    { quantity: "", item: " " },
  ],
  steps: ["Warm the lentils.", "", "Simmer 20 minutes."],
  notes: "Better the next day.",
};

describe("AI help is admin-only, checked before any Claude call (AC-066, AC-067)", () => {
  it("refuses signed-out and non-admin requests without calling the AI", async () => {
    const viewer = await sessionCookieFor(services, "someone@example.com");
    const body = { recipeId, mode: "substitute", ingredient: "sour cream" };
    expect((await run(helpAction(args(json(body))))).status).toBe(401);
    expect((await run(helpAction(args(json(body, viewer))))).status).toBe(403);
    expect((await run(editAction(args(post(`/recipes/${recipeId}/edit`, { intent: "revised", draft: "{}" }, viewer), { id: recipeId })))).status).toBe(403);
    expect(ai.calls).toHaveLength(0);
    // The panel is offered to admins only, and says when AI isn't set up.
    const page = await run(recipeLoader(args(new Request(`${BASE_URL}/recipes/${recipeId}`), { id: recipeId })));
    expect(page.body.aiEnabled).toBe(true);
  });

  it("says AI isn't set up when there's no key", async () => {
    services = createTestServices();
    admin = await sessionCookieFor(services, ADMIN_EMAIL);
    const response = await run(helpAction(args(json({ recipeId, mode: "change", request: "vegetarian" }, admin))));
    expect(response.status).toBe(503);
  });
});

describe("missing an ingredient", () => {
  it("suggests swaps for one of the recipe's ingredients, using what the cook has and their preferences", async () => {
    await services.preferences.add("We like mild food", actor);
    const response = await run(helpAction(args(json({ recipeId, mode: "substitute", ingredient: "sour cream", have: " Greek yogurt,  lemons " }, admin))));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ingredient: "sour cream",
      options: [{ use: "plain yogurt", amount: "same amount", how: "", effect: "A little tangier." }],
      message: null,
    });
    expect(ai.calls[0]).toMatchObject({
      method: "suggestSubstitutes",
      input: {
        ingredient: "sour cream",
        have: "Greek yogurt, lemons",
        preferences: ["We like mild food"],
        recipe: { title: "Beef Chili", ingredients: [{ quantity: "1 lb", item: "ground beef" }, { quantity: "1 cup", item: "sour cream" }] },
      },
    });
  });

  it("rejects an ingredient that isn't in the recipe, and unknown recipes, without calling the AI", async () => {
    expect((await run(helpAction(args(json({ recipeId, mode: "substitute", ingredient: "saffron" }, admin))))).status).toBe(400);
    expect((await run(helpAction(args(json({ recipeId, mode: "substitute", ingredient: "sour cream", have: "x".repeat(201) }, admin))))).status).toBe(400);
    expect((await run(helpAction(args(json({ recipeId: "nope", mode: "substitute", ingredient: "sour cream" }, admin))))).status).toBe(404);
    expect((await run(helpAction(args(json({ recipeId, mode: "other" }, admin))))).status).toBe(400);
    expect(ai.calls).toHaveLength(0);
  });

  it("a swap can be kept as a dated note, which doesn't change the recipe or make a version", async () => {
    const result = await run(recipeAction(args(post(`/recipes/${recipeId}`, { note: "AI swap idea for sour cream: plain yogurt (same amount)." }, admin), { id: recipeId })));
    expect(result.body.noteError).toBeNull();
    expect((await services.catalog.listNotes(recipeId)).map((n) => n.body)).toEqual(["AI swap idea for sour cream: plain yogurt (same amount)."]);
    expect((await services.catalog.get(recipeId))!.revision).toBe(1);
  });
});

describe("change this recipe", () => {
  it("returns the changed recipe and what changed, tidied", async () => {
    ai.revision = { ok: true, value: { recipe: revised, changes: ["Swapped the beef for 2 cans of lentils", " "], message: null } };
    const response = await run(helpAction(args(json({ recipeId, mode: "change", request: "make it vegetarian" }, admin))));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      request: "make it vegetarian",
      recipe: {
        title: "Lentil Chili",
        description: "",
        servings: "Serves 4",
        yieldText: "Serves 4",
        prepTime: "",
        cookTime: "",
        ingredients: [
          { quantity: "2 cans", item: "lentils" },
          { quantity: "1 cup", item: "sour cream" },
        ],
        steps: ["Warm the lentils.", "Simmer 20 minutes."],
        notes: "Better the next day.",
      },
      changes: ["Swapped the beef for 2 cans of lentils"],
      message: null,
    });
    expect(ai.calls[0]).toMatchObject({ method: "reviseRecipe", input: { request: "make it vegetarian" } });
  });

  it("explains a change the AI couldn't make, and empty requests", async () => {
    ai.revision = { ok: true, value: { recipe: { ...revised, steps: [] }, changes: [], message: "Chili without simmering doesn't work." } };
    const response = await run(helpAction(args(json({ recipeId, mode: "change", request: "no cooking" }, admin))));
    expect(response).toMatchObject({ status: 502, body: { message: "Chili without simmering doesn't work." } });
    expect((await run(helpAction(args(json({ recipeId, mode: "change", request: "  " }, admin))))).status).toBe(400);
  });

  it("'Edit this recipe' fills the editor and saving makes a new version; the old one stays in history (D2)", async () => {
    const draft = JSON.stringify({ title: "Lentil Chili", description: null, yieldText: "Serves 4", prepTime: null, cookTime: null, ingredients: revised.ingredients.slice(0, 2), steps: ["Warm the lentils.", "Simmer 20 minutes."], notes: null });
    const opened = await run(
      editAction(args(post(`/recipes/${recipeId}/edit`, { intent: "revised", draft, changes: JSON.stringify(["Swapped the beef for lentils"]), request: "make it vegetarian" }, admin), { id: recipeId })),
    );
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({
      aiChanges: ["Swapped the beef for lentils"],
      values: { title: "Lentil Chili", steps: "Warm the lentils.\nSimmer 20 minutes.", notes: "Better the next day.", revision: 1, changeNote: "AI change: make it vegetarian" },
    });
    expect((await services.catalog.get(recipeId))!.title).toBe("Beef Chili"); // nothing saved yet
    expect(ai.calls).toHaveLength(0);

    // The owner presses Save in the editor.
    const v = opened.body.values;
    const save = post(`/recipes/${recipeId}/edit`, {
      kind: v.kind,
      title: v.title,
      description: v.description,
      notes: v.notes,
      yieldText: v.yieldText,
      prepTime: v.prepTime,
      cookTime: v.cookTime,
      steps: v.steps,
      sourceUrl: v.sourceUrl,
      sourceName: v.sourceName,
      tags: v.tags,
      revision: String(v.revision),
      changeNote: v.changeNote,
    }, admin);
    const form = await save.formData();
    for (const i of v.ingredients as { quantity: string; item: string }[]) {
      form.append("ingredientQuantity", i.quantity);
      form.append("ingredientItem", i.item);
    }
    await run(editAction(args(new Request(save.url, { method: "POST", body: form, headers: { Cookie: admin } }), { id: recipeId })));
    const entry = (await services.catalog.get(recipeId))!;
    expect(entry.revision).toBe(2);
    expect(entry.title).toBe("Lentil Chili");
    expect(entry.ingredients).toEqual([
      { quantity: "2 cans", item: "lentils" },
      { quantity: "1 cup", item: "sour cream" },
    ]);
    const history = await services.catalog.history(recipeId);
    expect(history.map((h) => h.revision)).toEqual([2, 1]);
  });

  it("'Save as a new recipe' opens the import editor with the changed recipe", async () => {
    const draft = JSON.stringify({ title: "Lentil Chili", description: null, yieldText: "Serves 4", prepTime: null, cookTime: null, ingredients: [{ quantity: "2 cans", item: "lentils" }], steps: ["Simmer."], notes: null });
    const review = await run(importAction(args(post("/recipes/import", { intent: "written", draft }, admin))));
    expect(review.body).toMatchObject({ stage: "review", values: { title: "Lentil Chili", origin: "ai" } });
    expect(await services.catalog.digestSources()).toHaveLength(1);
  });
});
