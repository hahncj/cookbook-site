// Live smoke test against the real Claude API (M5). Costs a few cents.
// Run: ANTHROPIC_API_KEY=sk-ant-... npm run smoke:ai
// Uses the same adapter the site uses. Not part of `npm test`.
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, describe, expect, it } from "vitest";
import { createAnthropicAi } from "../../server/ai/anthropic";
import type { DiscoverInput, RecipeForHelp } from "../../server/core/ai";

const apiKey = process.env.ANTHROPIC_API_KEY;
const ai = apiKey ? createAnthropicAi({ apiKey, model: process.env.ANTHROPIC_MODEL || undefined }) : null;

const pasted = `Sure! Here's the recipe we worked out:

Gochujang Butter Noodles (serves 2)
- 200 g udon noodles
- 2 tbsp butter
- 1½ tbsp gochujang
- green onions, sliced
- some sesame seeds

1. Boil the noodles.
2. Melt the butter with the gochujang, then toss with the noodles.
3. Top with green onions and sesame seeds.

Want me to make a vegetarian version too?`;

describe.skipIf(!ai)("Claude live smoke test", { timeout: 180_000 }, () => {
  it("imports a pasted chat recipe faithfully, without invented amounts", async () => {
    const result = await ai!.extractRecipe({ text: pasted });
    console.log(JSON.stringify(result, null, 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = result.value;
    expect(r.title).toMatch(/gochujang/i);
    expect(r.ingredients.find((i) => /gochujang/i.test(i.item))?.quantity).toBe("1½ tbsp");
    for (const i of r.ingredients.filter((x) => /green onion|sesame/i.test(x.item))) expect(i.quantity).not.toMatch(/\d/);
    expect(r.steps).toHaveLength(3);
  });

  it("reports text without a recipe instead of inventing one", async () => {
    const result = await ai!.extractRecipe({ text: "Thanks! The weather here is lovely today." });
    expect(result).toMatchObject({ ok: false, reason: "no_recipe" });
  });

  it("identifies ingredients from a description and compares two recipes", async () => {
    const identified = await ai!.identifyIngredients({ images: [], description: "Pesto pasta with cherry tomatoes and parmesan on top" });
    console.log(JSON.stringify(identified));
    expect(identified.ok && identified.value.suggestions.length).toBeGreaterThan(0);
    const compared = await ai!.compareRecipes(
      "Title: Gochujang noodles\nIngredients:\n- udon\n- gochujang\n- butter",
      "Title: Spicy butter udon\nIngredients:\n- udon\n- gochujang\n- butter\n- scallions",
    );
    console.log(JSON.stringify(compared));
    expect(compared.ok).toBe(true);
  });
});

// ---------- Cost and timing for AI search and AI help (M8) ----------
// Records every API response's usage, so the real cost of each feature can be
// compared with the estimates in docs/costs.md. Prices: Claude Opus 5.5 at
// $4 / $20 per million input / output tokens, cache reads $0.20, cache writes
// $5 (5-minute), web search $10 per 1,000 searches. The prices only fit
// claude-opus-5-5 (the default model).
interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null;
}
let calls: Usage[] = [];
const measured: { feature: string; seconds: number; calls: number; input: number; output: number; searches: number; dollars: number }[] = [];

const recordingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await response.clone().json().catch(() => null)) as { usage?: Usage } | null;
    if (body?.usage) calls.push(body.usage);
  }
  return response;
};
const measuredAi = apiKey
  ? createAnthropicAi({
      apiKey,
      model: process.env.ANTHROPIC_MODEL || undefined,
      client: new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000, fetch: recordingFetch }),
    })
  : null;

async function measure<T>(feature: string, run: () => Promise<T>): Promise<T> {
  calls = [];
  const started = Date.now();
  const result = await run();
  const seconds = (Date.now() - started) / 1000;
  const sum = (pick: (u: Usage) => number | null | undefined) => calls.reduce((total, u) => total + (pick(u) ?? 0), 0);
  const input = sum((u) => u.input_tokens);
  const output = sum((u) => u.output_tokens);
  const cacheRead = sum((u) => u.cache_read_input_tokens);
  const cacheWrite = sum((u) => u.cache_creation_input_tokens);
  const searches = sum((u) => u.server_tool_use?.web_search_requests);
  const dollars = (input * 4 + output * 20 + cacheRead * 0.2 + cacheWrite * 5) / 1_000_000 + searches * 0.01;
  measured.push({ feature, seconds, calls: calls.length, input: input + cacheRead + cacheWrite, output, searches, dollars });
  return result;
}

const sampleRecipe: RecipeForHelp = {
  title: "Gochujang Butter Noodles",
  yieldText: "Serves 2",
  ingredients: [
    { quantity: "6 oz", item: "dried wheat noodles" },
    { quantity: "2 tbsp", item: "unsalted butter" },
    { quantity: "1½ tbsp", item: "gochujang" },
    { quantity: "2 cloves", item: "garlic, grated" },
    { quantity: "", item: "toasted sesame seeds, to taste" },
  ],
  steps: ["Cook the noodles; reserve ½ cup water.", "Melt butter, add garlic, whisk in gochujang.", "Toss noodles in the sauce with a splash of water."],
  notes: null,
};

// About 100 saved titles, like a real cookbook, so the input size is realistic.
const cookbookTitles = Array.from({ length: 100 }, (_, i) => `Saved recipe number ${i + 1}`);
const searchInput = (source: "write" | "web", exclude: string[] = []): DiscoverInput => ({
  request: "a quick weeknight soup",
  source,
  preferences: [
    { statement: "Likes spicy food", confirmed: true },
    { statement: "Often cooks on weeknights", confirmed: false },
  ],
  rejected: ["Vegetarian"],
  favorites: ["Gochujang Butter Noodles"],
  cookbookTitles,
  exclude,
  today: new Date().toISOString().slice(0, 10),
});

describe.skipIf(!measuredAi)("AI search and AI help: real cost and timing", { timeout: 300_000 }, () => {
  afterAll(() => {
    console.log("\nFeature | Seconds | API calls | Input tokens | Output tokens | Web searches | Cost (USD)");
    for (const m of measured) {
      console.log(`${m.feature} | ${m.seconds.toFixed(1)} | ${m.calls} | ${m.input} | ${m.output} | ${m.searches} | $${m.dollars.toFixed(3)}`);
    }
  });

  it("AI: writes 2-3 new recipes, then More", async () => {
    const first = await measure("AI search (write)", () => measuredAi!.discover(searchInput("write")));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.written.length).toBeGreaterThanOrEqual(1);
    expect(first.value.web).toHaveLength(0);
    const more = await measure("AI search More", () => measuredAi!.discover(searchInput("write", first.value.written.map((r) => r.title))));
    expect(more.ok).toBe(true);
  });

  it("Web: finds real pages whose links came from the search, then More", async () => {
    const first = await measure("Web search", () => measuredAi!.discover(searchInput("web")));
    console.log(JSON.stringify(first, null, 2));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.written).toHaveLength(0);
    const seen = new Set(first.value.webSources.map((s) => s.url));
    for (const page of first.value.web) expect(seen.has(page.url), page.url).toBe(true);
    const more = await measure("Web search More", () => measuredAi!.discover(searchInput("web", first.value.web.map((p) => p.url))));
    expect(more.ok).toBe(true);
  });

  it("AI help: swaps for a missing ingredient", async () => {
    const result = await measure("AI help swaps", () =>
      measuredAi!.suggestSubstitutes({ recipe: sampleRecipe, ingredient: "gochujang", have: "sriracha, miso", preferences: ["Likes spicy food"] }),
    );
    expect(result.ok && result.value.options.length).toBeGreaterThan(0);
  });

  it("AI help: changes the recipe", async () => {
    const result = await measure("AI help change", () =>
      measuredAi!.reviseRecipe({ recipe: sampleRecipe, request: "make it gluten-free", preferences: ["Likes spicy food"] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.changes.length).toBeGreaterThan(0);
  });
});
