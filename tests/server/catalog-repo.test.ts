import { beforeEach, describe, expect, it } from "vitest";
import type { Services } from "../../server/app";
import { validateEntry, type EntryInput } from "../../server/core/recipes";
import { createTestServices } from "../helpers/services";

const actor = { userId: "admin-1" };
let services: Services;

function input(overrides: Partial<EntryInput> = {}): EntryInput {
  const result = validateEntry({
    kind: "recipe",
    title: "Gochujang Butter Noodles",
    description: "Glossy, spicy-sweet noodles.",
    notes: "Tried with udon.",
    yieldText: "Serves 2",
    prepTime: "10 min",
    cookTime: "10 min",
    ingredients: [
      { quantity: "6 oz", item: "dried wheat noodles" },
      { quantity: "1½ tbsp", item: "gochujang" },
    ],
    steps: ["Boil the noodles.", "Toss with the sauce."],
    sourceUrl: null,
    sourceName: null,
    tags: ["Weeknight", "Noodles"],
    collectionIds: [],
    ...overrides,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

beforeEach(() => {
  services = createTestServices();
});

describe("catalog: create and read", () => {
  it("saves a recipe and reads it back with tags (AC-005, AC-068)", async () => {
    const created = await services.catalog.create(input(), actor);
    expect(created.ok).toBe(true);
    const entry = await services.catalog.get(created.ok ? created.id : "");
    expect(entry).toMatchObject({
      title: "Gochujang Butter Noodles",
      revision: 1,
      origin: "manual",
      ingredients: [
        { quantity: "6 oz", item: "dried wheat noodles" },
        { quantity: "1½ tbsp", item: "gochujang" },
      ],
      tags: [
        { name: "Noodles" },
        { name: "Weeknight" },
      ],
    });
  });

  it("reuses existing tags case-insensitively", async () => {
    await services.catalog.create(input({ tags: ["Weeknight"] }), actor);
    await services.catalog.create(input({ title: "Chili", tags: ["WEEKNIGHT"] }), actor);
    const tags = await services.catalog.listTags();
    expect(tags).toEqual([expect.objectContaining({ name: "Weeknight", count: 2 })]);
  });
});

describe("catalog: search and filters (AC-009)", () => {
  beforeEach(async () => {
    await services.catalog.create(input(), actor);
    await services.catalog.create(
      input({ title: "Weeknight Black Bean Chili", ingredients: [{ quantity: "2 cans", item: "black beans" }], notes: null, tags: ["Batch"] }),
      actor,
    );
    await services.catalog.create(input({ kind: "idea", title: "Miso caramel peaches?", ingredients: [], steps: [], notes: null, tags: [] }), actor);
  });

  it("searches titles, ingredients, and notes, with prefix matching", async () => {
    expect((await services.catalog.browse({ q: "gochu" })).items.map((i) => i.title)).toEqual(["Gochujang Butter Noodles"]);
    expect((await services.catalog.browse({ q: "black beans" })).items.map((i) => i.title)).toEqual(["Weeknight Black Bean Chili"]);
    expect((await services.catalog.browse({ q: "udon" })).items.map((i) => i.title)).toEqual(["Gochujang Butter Noodles"]);
    expect((await services.catalog.browse({ q: "nothing-matches" })).total).toBe(0);
  });

  it("treats search syntax as plain text", async () => {
    await expect(services.catalog.browse({ q: 'chili" OR *' })).resolves.toBeDefined();
  });

  it("filters by tag (case-insensitive) and by kind", async () => {
    expect((await services.catalog.browse({ tag: "batch" })).items.map((i) => i.title)).toEqual(["Weeknight Black Bean Chili"]);
    expect((await services.catalog.browse({ kind: "idea" })).items.map((i) => i.title)).toEqual(["Miso caramel peaches?"]);
  });

  it("filters by collection", async () => {
    const collection = await services.catalog.createCollection("Weeknight rotation");
    const created = await services.catalog.create(input({ title: "Lemon Chicken", collectionIds: [collection!.id] }), actor);
    expect(created.ok).toBe(true);
    const result = await services.catalog.browse({ collection: collection!.id });
    expect(result.items.map((i) => i.title)).toEqual(["Lemon Chicken"]);
    expect(await services.catalog.listCollections()).toEqual([expect.objectContaining({ name: "Weeknight rotation", count: 1 })]);
  });

  it("returns ingredient previews for entries shown without photos", async () => {
    const chili = (await services.catalog.browse({ q: "chili" })).items[0];
    expect(chili?.ingredientPreview).toEqual(["black beans"]);
  });
});

describe("catalog: updates", () => {
  it("updates content, tags and collections and bumps the revision", async () => {
    const collection = await services.catalog.createCollection("Favorites");
    const created = await services.catalog.create(input(), actor);
    const id = created.ok ? created.id : "";
    const result = await services.catalog.update(id, 1, input({ title: "Better Noodles", tags: ["Spicy"], collectionIds: [collection!.id] }), actor);
    expect(result).toEqual({ ok: true, id });
    const entry = await services.catalog.get(id);
    expect(entry).toMatchObject({ title: "Better Noodles", revision: 2, tags: [{ name: "Spicy" }], collections: [{ name: "Favorites" }] });
    expect((await services.catalog.browse({ q: "better" })).total).toBe(1);
    expect((await services.catalog.browse({ q: "gochujang butter" })).total).toBe(0);
  });

  it("rejects a stale revision instead of overwriting newer edits (AC-031)", async () => {
    const created = await services.catalog.create(input(), actor);
    const id = created.ok ? created.id : "";
    await services.catalog.update(id, 1, input({ title: "Edit from tab A" }), actor);
    const stale = await services.catalog.update(id, 1, input({ title: "Edit from tab B", tags: ["Lost"] }), actor);
    expect(stale).toEqual({ ok: false, reason: "conflict" });
    const entry = await services.catalog.get(id);
    expect(entry).toMatchObject({ title: "Edit from tab A", revision: 2 });
    expect(entry?.tags.map((t) => t.name)).not.toContain("Lost");
  });

  it("reports a missing entry", async () => {
    expect(await services.catalog.update("nope", 1, input(), actor)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("catalog: delete and recover (D6)", () => {
  it("hides deleted entries everywhere public but keeps them recoverable", async () => {
    const created = await services.catalog.create(input(), actor);
    const id = created.ok ? created.id : "";
    expect(await services.catalog.remove(id, actor)).toBe(true);
    expect(await services.catalog.get(id)).toBeNull();
    expect((await services.catalog.browse({})).total).toBe(0);
    expect((await services.catalog.browse({ q: "gochujang" })).total).toBe(0);
    expect(await services.catalog.listTags()).toEqual([]);
    expect((await services.catalog.listDeleted()).map((e) => e.id)).toEqual([id]);
    expect((await services.catalog.getIncludingDeleted(id))?.deletedAt).toBeInstanceOf(Date);

    expect(await services.catalog.restore(id, actor)).toBe(true);
    expect((await services.catalog.get(id))?.title).toBe("Gochujang Butter Noodles");
    expect(await services.catalog.listDeleted()).toEqual([]);
  });

  it("does not edit a deleted entry", async () => {
    const created = await services.catalog.create(input(), actor);
    const id = created.ok ? created.id : "";
    await services.catalog.remove(id, actor);
    expect(await services.catalog.update(id, 1, input({ title: "Ghost edit" }), actor)).toEqual({ ok: false, reason: "not_found" });
  });

  it("is idempotent", async () => {
    const created = await services.catalog.create(input(), actor);
    const id = created.ok ? created.id : "";
    expect(await services.catalog.remove(id, actor)).toBe(true);
    expect(await services.catalog.remove(id, actor)).toBe(false);
  });
});
