import { beforeEach, describe, expect, it } from "vitest";
import { createRouterContext } from "../../app/context";
import { action as compareAction } from "../../app/routes/api.ai.compare";
import { action as ingredientsAction } from "../../app/routes/api.ai.ingredients";
import { action as duplicatesAction } from "../../app/routes/api.duplicates";
import { loader as homeLoader } from "../../app/routes/home";
import { loader as recipeLoader } from "../../app/routes/recipe";
import { loader as reviewLoader } from "../../app/routes/review";
import { action as importAction, loader as importLoader } from "../../app/routes/recipe-import";
import type { Services } from "../../server/app";
import { validateEntry } from "../../server/core/recipes";
import { FakeAi, sampleDraft } from "../helpers/fake-ai";
import { jpegWithMetadata } from "../helpers/images";
import { MemoryMediaStore } from "../helpers/memory-media";
import { ADMIN_EMAIL, BASE_URL, createTestServices, sessionCookieFor } from "../helpers/services";

let services: Services;
let ai: FakeAi;
let admin: string;
let pages: Record<string, string>;

beforeEach(async () => {
  ai = new FakeAi();
  pages = {};
  services = createTestServices({
    media: new MemoryMediaStore(),
    ai,
    fetchPage: async (url) => (pages[url] ? { ok: true, url, html: pages[url]! } : { ok: false, message: "The page couldn't be loaded (error 404)." }),
  });
  admin = await sessionCookieFor(services, ADMIN_EMAIL);
});

const args = (request: Request, params: Record<string, string> = {}) =>
  ({ request, params, context: createRouterContext(services) }) as never;

const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${BASE_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(init.cookie ? { Cookie: init.cookie } : {}) } });

/** Unwraps data()/Response/thrown results into {status, body}. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON bodies in assertions
async function run(promise: Promise<unknown>): Promise<{ status: number; body: any }> {
  let result: unknown;
  try {
    result = await promise;
  } catch (thrown) {
    result = thrown;
  }
  if (result instanceof Response) {
    const text = await result.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // plain text
    }
    return { status: result.status, body };
  }
  const wrapped = result as { type?: string; data?: unknown; init?: { status?: number } };
  if (wrapped && wrapped.type === "DataWithResponseInit") return { status: wrapped.init?.status ?? 200, body: wrapped.data };
  return { status: 200, body: result };
}

const form = (fields: Record<string, string | Blob>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return body;
};

const json = (value: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });

async function createRecipe(title: string, items: string[] = []) {
  const valid = validateEntry({ kind: "recipe", title, ingredients: items.map((item) => ({ quantity: "", item })), steps: [], tags: [], collectionIds: [] });
  if (!valid.ok) throw new Error();
  const created = await services.catalog.create(valid.value, { userId: "seed" });
  return created.ok ? created.id : "";
}

describe("paid AI is admin-only, checked before any provider call (AC-066, AC-067)", () => {
  it("rejects signed-out and non-admin requests without calling the AI", async () => {
    const id = await createRecipe("Noodles");
    const someone = await sessionCookieFor(services, "someone@example.com");
    for (const [cookie, expected] of [
      [undefined, 401],
      [someone, 403],
    ] as const) {
      const attempts = [
        () => importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "paste", text: "A recipe" }), cookie }))),
        () => importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "link", url: "https://e.example/r" }), cookie }))),
        () => importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "photo", image: new Blob([jpegWithMetadata()]) }), cookie }))),
        () => ingredientsAction(args(req("/api/ai/ingredients", { method: "POST", body: form({ description: "noodles" }), cookie }))),
        () => compareAction(args(req("/api/ai/compare", { ...json({ recipeId: id, draft: { title: "Noodles" } }), cookie }))),
        () => duplicatesAction(args(req("/api/duplicates", { ...json({ title: "Noodles" }), cookie }))),
      ];
      for (const attempt of attempts) expect((await run(attempt())).status).toBe(expected);
    }
    expect(ai.calls).toEqual([]);
  });

  it("public browsing and search never call the AI", async () => {
    const id = await createRecipe("Gochujang Noodles", ["udon"]);
    await run(homeLoader(args(req("/?q=noodles"))));
    await run(recipeLoader(args(req(`/recipes/${id}`), { id })));
    expect(ai.calls).toEqual([]);
  });

  it("the import page itself needs an admin", async () => {
    expect((await run(importLoader(args(req("/recipes/import"))))).status).toBe(302);
  });
});

describe("paste import (AC-049)", () => {
  it("extracts a draft for review without saving it, then saves it as a paste import", async () => {
    const text = "Here's that recipe!\nGochujang Butter Noodles\n200 g udon...";
    const extracted = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "paste", text }), cookie: admin }))));
    expect(extracted.status).toBe(200);
    expect(extracted.body.stage).toBe("review");
    expect(extracted.body.values).toMatchObject({ title: "Gochujang Butter Noodles", origin: "paste", yieldText: "Serves 2" });
    expect(ai.calls[0]).toMatchObject({ method: "extractRecipe", input: { text } });
    expect((await services.catalog.browse({})).total).toBe(0); // nothing saved yet (D2)

    // The owner reviews and saves: same route, no intent.
    const v = extracted.body.values;
    const save = form({ kind: v.kind, title: v.title, yieldText: v.yieldText, steps: v.steps, origin: "paste", revision: "0" });
    for (const row of v.ingredients) {
      save.append("ingredientQuantity", row.quantity);
      save.append("ingredientItem", row.item);
    }
    const saved = await run(importAction(args(req("/recipes/import", { method: "POST", body: save, cookie: admin }))));
    expect(saved.status).toBe(303);
    const list = await services.catalog.browse({ q: "gochujang" });
    expect(list.total).toBe(1);
    const entry = await services.catalog.get(list.items[0]!.id);
    expect(entry).toMatchObject({ origin: "paste", ingredients: v.ingredients });
  });

  it("explains failures, keeps the pasted text, and invents nothing (AC-033, AC-048)", async () => {
    ai.extract = { ok: false, reason: "no_recipe", message: "No recipe was found in this input." };
    const result = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "paste", text: "hello there" }), cookie: admin }))));
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ stage: "input", tab: "paste", text: "hello there" });
    expect(result.body.error).toMatch(/No recipe was found/);
    expect((await services.catalog.browse({})).total).toBe(0);

    ai.extract = { ok: false, reason: "failed", message: "The AI service is busy right now. Wait a minute and try again." };
    const busy = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "paste", text: "a recipe" }), cookie: admin }))));
    expect(busy.body.error).toMatch(/busy/);
  });

  it("notes extra recipes and uncertain parts", async () => {
    ai.extract = { ok: true, value: sampleDraft({ otherRecipes: 2, uncertain: ["Oven temperature unclear"] }) };
    const result = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "paste", text: "two recipes" }), cookie: admin }))));
    expect(result.body).toMatchObject({ otherRecipes: 2, uncertain: ["Oven temperature unclear"], method: "ai" });
  });
});

describe("link import (AC-008)", () => {
  it("uses the page's recipe data without AI when present", async () => {
    pages["https://e.example/r"] = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "Lemon Tart",
      recipeIngredient: ["3 lemons"],
      recipeInstructions: "Bake.",
    })}</script>`;
    const result = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "link", url: "https://e.example/r" }), cookie: admin }))));
    expect(result.body).toMatchObject({ stage: "review", method: "structured", values: { title: "Lemon Tart", origin: "web", sourceUrl: "https://e.example/r" } });
    expect(ai.calls).toEqual([]);
  });

  it("falls back to Claude on the page text, keeping the source link", async () => {
    pages["https://e.example/plain"] = `<html><body><h1>Grandma's soup</h1><p>${"Chop onions and simmer with stock for an hour. ".repeat(4)}</p></body></html>`;
    const result = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "link", url: "https://e.example/plain" }), cookie: admin }))));
    expect(result.body).toMatchObject({ stage: "review", method: "ai", values: { sourceUrl: "https://e.example/plain", origin: "web" } });
    expect(ai.calls[0]!.input).toMatchObject({ sourceUrl: "https://e.example/plain" });
    expect(JSON.stringify(ai.calls[0]!.input)).not.toContain("<h1>");
  });

  it("explains unreachable pages and keeps the link", async () => {
    const result = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "link", url: "https://e.example/missing" }), cookie: admin }))));
    expect(result).toMatchObject({ status: 422, body: { stage: "input", tab: "link", url: "https://e.example/missing" } });
    expect(ai.calls).toEqual([]);
  });
});

describe("image import (AC-008)", () => {
  it("sends a valid image to the AI and keeps the photo when asked", async () => {
    const photo = crypto.randomUUID();
    const result = await run(
      importAction(
        args(req("/recipes/import", { method: "POST", body: form({ intent: "photo", image: new Blob([jpegWithMetadata()]), keepPhotoId: photo }), cookie: admin })),
      ),
    );
    expect(result.body).toMatchObject({ stage: "review", values: { origin: "image", photos: [{ id: photo, caption: "" }] } });
    expect((ai.calls[0]!.input as { image: { mediaType: string } }).image.mediaType).toBe("image/jpeg");
  });

  it("rejects files that aren't images, without calling the AI", async () => {
    const result = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "photo", image: new Blob(["%PDF-1.4"]) }), cookie: admin }))));
    expect(result.status).toBe(422);
    expect(result.body.error).toMatch(/JPEG, PNG or WebP/);
    expect(ai.calls).toEqual([]);
  });
});

describe("ingredient identification (AC-007, AC-045–047)", () => {
  it("works with a description alone, a photo alone, and both", async () => {
    const description = await run(ingredientsAction(args(req("/api/ai/ingredients", { method: "POST", body: form({ description: "spicy noodles" }), cookie: admin }))));
    expect(description.status).toBe(200);
    expect(description.body.suggestions).toEqual([
      { name: "udon noodles", confidence: "high", note: null },
      { name: "sesame seeds", confidence: "low", note: "Could be breadcrumbs" },
    ]);
    expect(JSON.stringify(description.body)).not.toMatch(/quantity/); // names only, no amounts (AC-046)

    const photo = await run(ingredientsAction(args(req("/api/ai/ingredients", { method: "POST", body: form({ image: new Blob([jpegWithMetadata()]) }), cookie: admin }))));
    expect(photo.status).toBe(200);

    const both = form({ image: new Blob([jpegWithMetadata()]), description: "noodles" });
    expect((await run(ingredientsAction(args(req("/api/ai/ingredients", { method: "POST", body: both, cookie: admin }))))).status).toBe(200);

    expect(ai.calls.map((c) => c.input)).toMatchObject([
      { images: [], description: "spicy noodles" },
      { images: [{ mediaType: "image/jpeg" }], description: null },
      { images: [{ mediaType: "image/jpeg" }], description: "noodles" },
    ]);
  });

  it("can use a saved photo by id, and changes no recipe (AC-047)", async () => {
    const upload = form({ full: new Blob([jpegWithMetadata()]), thumb: new Blob([jpegWithMetadata()]) });
    const { action: photosAction } = await import("../../app/routes/api.photos");
    const stored = await run(photosAction(args(req("/api/photos", { method: "POST", body: upload, cookie: admin }))));
    const id = await createRecipe("Noodles", ["udon"]);
    const before = await services.catalog.get(id);
    const result = await run(ingredientsAction(args(req("/api/ai/ingredients", { method: "POST", body: form({ photoId: stored.body.id }), cookie: admin }))));
    expect(result.status).toBe(200);
    expect((ai.calls[0]!.input as { images: unknown[] }).images).toHaveLength(1);
    expect(await services.catalog.get(id)).toEqual(before);
  });

  it("asks for input, and reports AI failures plainly", async () => {
    expect((await run(ingredientsAction(args(req("/api/ai/ingredients", { method: "POST", body: form({}), cookie: admin }))))).status).toBe(400);
    ai.identify = { ok: false, reason: "failed", message: "The AI service had a problem. Try again in a moment." };
    const failed = await run(ingredientsAction(args(req("/api/ai/ingredients", { method: "POST", body: form({ description: "x" }), cookie: admin }))));
    expect(failed).toMatchObject({ status: 502, body: { message: /problem/ } });
  });
});

describe("duplicates (AC-057)", () => {
  it("imports report likely duplicates; nothing is merged", async () => {
    const id = await createRecipe("Gochujang Butter Noodles", ["udon noodles", "gochujang", "butter"]);
    await createRecipe("Lemon Tart", ["lemons"]);
    const result = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "paste", text: "noodles" }), cookie: admin }))));
    expect(result.body.duplicates.map((d: { id: string }) => d.id)).toEqual([id]);
    expect((await services.catalog.browse({})).total).toBe(2);
  });

  it("the free check runs without AI; the AI check runs only on request", async () => {
    const id = await createRecipe("Gochujang Butter Noodles", ["udon noodles", "gochujang"]);
    const free = await run(duplicatesAction(args(req("/api/duplicates", { ...json({ title: "gochujang noodles", ingredients: ["udon noodles"] }), cookie: admin }))));
    expect(free.body.matches[0]).toMatchObject({ id, title: "Gochujang Butter Noodles" });
    const excluded = await run(duplicatesAction(args(req("/api/duplicates", { ...json({ title: "gochujang noodles", excludeId: id }), cookie: admin }))));
    expect(excluded.body.matches).toEqual([]);
    expect(ai.calls).toEqual([]);

    const checked = await run(compareAction(args(req("/api/ai/compare", { ...json({ recipeId: id, draft: { title: "Gochujang noodles", ingredients: ["udon"], steps: [] } }), cookie: admin }))));
    expect(checked.body).toEqual({ verdict: "same", explanation: "Same noodles and sauce." });
    expect(ai.calls).toHaveLength(1);
    expect((ai.calls[0]!.input as { b: string }).b).toContain("Gochujang Butter Noodles");
  });
});

describe("Review shows possible duplicates for AI-tool submissions", () => {
  it("lists a free match for a new recipe without calling the AI", async () => {
    const id = await createRecipe("Gochujang Butter Noodles", ["udon noodles", "gochujang"]);
    const submitted = await services.submissions.submitNew(
      { credentialKind: "api_key", credentialId: "k1", clientName: "Test tool", userId: "seed" },
      { recipe: { title: "Gochujang noodles", ingredients: [{ quantity: "", item: "udon noodles" }], steps: [] }, idempotencyKey: "dup-1" },
    );
    expect(submitted.status).toBe("pending");
    const page = await run(reviewLoader(args(req("/review", { cookie: admin }))));
    expect(page.body.pending[0].duplicates.map((d: { id: string }) => d.id)).toEqual([id]);
    expect(ai.calls).toEqual([]);
  });
});

describe("without an API key (AC-036)", () => {
  beforeEach(async () => {
    services = createTestServices({
      fetchPage: async (url) => ({
        ok: true,
        url,
        html: `<script type="application/ld+json">{"@type":"Recipe","name":"Tart","recipeIngredient":["egg"]}</script>`,
      }),
    });
    admin = await sessionCookieFor(services, ADMIN_EMAIL);
  });

  it("AI features say they're not set up; link import with recipe data and manual editing still work", async () => {
    expect((await run(importLoader(args(req("/recipes/import", { cookie: admin }))))).body.aiEnabled).toBe(false);
    const paste = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "paste", text: "x" }), cookie: admin }))));
    expect(paste.body.error).toMatch(/aren't set up/);
    const ingredients = await run(ingredientsAction(args(req("/api/ai/ingredients", { method: "POST", body: form({ description: "x" }), cookie: admin }))));
    expect(ingredients.status).toBe(503);
    const link = await run(importAction(args(req("/recipes/import", { method: "POST", body: form({ intent: "link", url: "https://e.example/t" }), cookie: admin }))));
    expect(link.body).toMatchObject({ stage: "review", values: { title: "Tart" } });
    const id = await createRecipe("Saved recipe");
    expect((await run(recipeLoader(args(req(`/recipes/${id}`), { id })))).status).toBe(200);
  });
});
