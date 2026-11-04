// Live smoke test against the real Claude API (M5). Costs a few cents.
// Run: ANTHROPIC_API_KEY=sk-ant-... npm run smoke:ai
// Uses the same adapter the site uses. Not part of `npm test`.
import { describe, expect, it } from "vitest";
import { createAnthropicAi } from "../../server/ai/anthropic";

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
