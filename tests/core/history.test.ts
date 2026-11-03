import { describe, expect, it } from "vitest";
import { diffSnapshots, snapshotToInput, type RevisionSnapshot } from "../../server/core/history";

const base: RevisionSnapshot = {
  kind: "recipe",
  title: "Noodles",
  description: "Glossy.",
  notes: null,
  yieldText: "Serves 2",
  prepTime: "10 min",
  cookTime: null,
  ingredients: [
    { quantity: "6 oz", item: "noodles" },
    { quantity: "2 tsp", item: "honey" },
  ],
  steps: ["Boil.", "Toss."],
  sourceUrl: null,
  sourceName: null,
  tags: ["Weeknight"],
  collections: [{ id: "c1", name: "Rotation" }],
  photos: [],
};

describe("diffSnapshots", () => {
  it("reports nothing for identical versions", () => {
    expect(diffSnapshots(base, structuredClone(base))).toEqual([]);
  });

  it("describes text and list changes in plain terms", () => {
    const next: RevisionSnapshot = {
      ...base,
      title: "Better Noodles",
      ingredients: [
        { quantity: "6 oz", item: "noodles" },
        { quantity: "1 tsp", item: "honey" },
      ],
      steps: ["Boil.", "Toss.", "Top with an egg."],
      tags: ["Weeknight", "Spicy"],
    };
    expect(diffSnapshots(base, next)).toEqual([
      { field: "title", label: "Title", type: "text", before: "Noodles", after: "Better Noodles" },
      { field: "ingredients", label: "Ingredients", type: "list", removed: ["2 tsp honey"], added: ["1 tsp honey"] },
      { field: "steps", label: "Method", type: "list", removed: [], added: ["Top with an egg."] },
      { field: "tags", label: "Tags", type: "list", removed: [], added: ["Spicy"] },
    ]);
  });

  it("notices reordering and repeated lines", () => {
    expect(diffSnapshots(base, { ...base, steps: ["Toss.", "Boil."] })).toEqual([
      { field: "steps", label: "Method (order)", type: "list", removed: [], added: ["Reordered"] },
    ]);
    expect(diffSnapshots(base, { ...base, steps: ["Boil.", "Toss.", "Toss."] })[0]).toMatchObject({ added: ["Toss."] });
  });

  it("turns a snapshot back into editor input", () => {
    expect(snapshotToInput(base)).toMatchObject({ title: "Noodles", tags: ["Weeknight"], collectionIds: ["c1"], photos: [] });
  });
});
