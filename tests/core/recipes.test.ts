import { describe, expect, it } from "vitest";
import {
  buildSearchQuery,
  jsonForScriptTag,
  normalizeTagNames,
  parseTagList,
  toIsoDuration,
  toSchemaOrgRecipe,
  validateEntry,
  type Entry,
} from "../../server/core/recipes";

const base = {
  kind: "recipe",
  title: "  Gochujang Butter Noodles ",
  description: "",
  notes: null,
  yieldText: "Serves 2",
  prepTime: "10 min",
  cookTime: "",
  ingredients: [
    { quantity: " 6 oz ", item: "dried noodles" },
    { quantity: "", item: "" },
    { quantity: "", item: "sesame seeds, to taste" },
  ],
  steps: ["Boil noodles.", "  ", "Toss with sauce."],
  sourceUrl: "",
  sourceName: "",
  tags: ["Weeknight", " weeknight ", "Noodles"],
  collectionIds: ["c1", "c1", ""],
};

describe("validateEntry", () => {
  it("trims, drops empty rows, and never invents missing details", () => {
    const result = validateEntry(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      title: "Gochujang Butter Noodles",
      description: null,
      cookTime: null,
      sourceUrl: null,
      ingredients: [
        { quantity: "6 oz", item: "dried noodles" },
        { quantity: "", item: "sesame seeds, to taste" },
      ],
      steps: ["Boil noodles.", "Toss with sauce."],
      tags: ["Weeknight", "Noodles"],
      collectionIds: ["c1"],
    });
  });

  it("accepts an idea with only a title (AC-005)", () => {
    const result = validateEntry({ kind: "idea", title: "Miso caramel peaches?", ingredients: [], steps: [], tags: [], collectionIds: [] });
    expect(result.ok).toBe(true);
  });

  it("reports readable field errors", () => {
    const result = validateEntry({ ...base, title: "   ", sourceUrl: "javascript:alert(1)" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.title).toBe("Give it a title");
    expect(result.errors.sourceUrl).toMatch(/http/);
  });
});

describe("tags", () => {
  it("normalizes and de-duplicates case-insensitively", () => {
    expect(normalizeTagNames(["  Spicy  food ", "spicy FOOD", "", "Sauces"])).toEqual(["Spicy food", "Sauces"]);
    expect(parseTagList("weeknight, Noodles ,,weeknight")).toEqual(["weeknight", "Noodles"]);
  });
});

describe("buildSearchQuery", () => {
  it("makes every word a required quoted prefix term", () => {
    expect(buildSearchQuery("gochu noodle")).toBe('"gochu"* AND "noodle"*');
  });

  it("neutralizes FTS syntax so input cannot inject operators", () => {
    expect(buildSearchQuery('chili" OR title:*')).toBe('"chili"* AND "OR"* AND "title"*');
    expect(buildSearchQuery("-salt +pepper")).toBe('"salt"* AND "pepper"*');
    expect(buildSearchQuery('  ""  ')).toBeNull();
    expect(buildSearchQuery("")).toBeNull();
  });
});

describe("toIsoDuration", () => {
  it.each([
    ["10 min", "PT10M"],
    ["1 hr 20 min", "PT1H20M"],
    ["1h30m", "PT1H30M"],
    ["45 minutes", "PT45M"],
    ["1.5 hours", "PT1H30M"],
    ["2 hours", "PT2H"],
  ])("%s → %s", (text, iso) => expect(toIsoDuration(text)).toBe(iso));

  it.each(["overnight", "about 10 min", "", "0 min"])("returns null for %j", (text) => expect(toIsoDuration(text)).toBeNull());
});

describe("schema.org Recipe", () => {
  const entry: Entry = {
    id: "r1",
    kind: "recipe",
    title: "Noodles",
    description: "Glossy.",
    notes: "private-ish note",
    yieldText: "Serves 2",
    prepTime: "10 min",
    cookTime: "overnight",
    ingredients: [{ quantity: "6 oz", item: "noodles" }],
    steps: ["Boil.", "Toss."],
    sourceUrl: null,
    sourceName: null,
    origin: "manual",
    revision: 1,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    updatedAt: new Date("2026-11-02T00:00:00Z"),
    deletedAt: null,
    tags: [{ id: "t", name: "Weeknight" }],
    collections: [],
  };

  it("emits ingredients, steps, and only parseable times", () => {
    const data = toSchemaOrgRecipe(entry, "https://example.test/recipes/r1");
    expect(data).toMatchObject({
      "@type": "Recipe",
      name: "Noodles",
      recipeYield: "Serves 2",
      prepTime: "PT10M",
      recipeIngredient: ["6 oz noodles"],
      recipeInstructions: [
        { "@type": "HowToStep", position: 1, text: "Boil." },
        { "@type": "HowToStep", position: 2, text: "Toss." },
      ],
      keywords: "Weeknight",
    });
    expect(data).not.toHaveProperty("cookTime");
  });

  it("is omitted for ideas", () => {
    expect(toSchemaOrgRecipe({ ...entry, kind: "idea" }, "https://x")).toBeNull();
  });

  it("cannot break out of its script tag", () => {
    expect(jsonForScriptTag({ name: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
});
