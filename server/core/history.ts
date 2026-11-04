// Version history: snapshots and human-readable comparisons. Pure logic.
import type { Entry, EntryInput, Ingredient, PhotoRef } from "./recipes";
import { ingredientLine } from "./recipes";

/** Everything a version shows. Stored as JSON in recipe_revisions.snapshot. */
export interface RevisionSnapshot {
  kind: "recipe" | "idea";
  title: string;
  description: string | null;
  notes: string | null;
  yieldText: string | null;
  prepTime: string | null;
  cookTime: string | null;
  ingredients: Ingredient[];
  steps: string[];
  sourceUrl: string | null;
  sourceName: string | null;
  tags: string[];
  collections: { id: string; name: string }[];
  photos: PhotoRef[];
}

export type RevisionOrigin = "create" | "edit" | "restore" | "ai" | "backfill";

export interface RevisionInfo {
  revision: number;
  origin: RevisionOrigin;
  changeNote: string | null;
  restoredFrom: number | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface Revision extends RevisionInfo {
  snapshot: RevisionSnapshot;
}

export function snapshotOf(input: EntryInput, collections: { id: string; name: string }[]): RevisionSnapshot {
  return {
    kind: input.kind,
    title: input.title,
    description: input.description,
    notes: input.notes,
    yieldText: input.yieldText,
    prepTime: input.prepTime,
    cookTime: input.cookTime,
    ingredients: input.ingredients,
    steps: input.steps,
    sourceUrl: input.sourceUrl,
    sourceName: input.sourceName,
    tags: input.tags,
    collections,
    photos: input.photos,
  };
}

export function snapshotOfEntry(entry: Entry): RevisionSnapshot {
  return snapshotOf(
    { ...entry, tags: entry.tags.map((tag) => tag.name), collectionIds: entry.collections.map((c) => c.id) },
    entry.collections,
  );
}

/** The input that restores a snapshot. Collections that no longer exist are skipped by the repository. */
export function snapshotToInput(snapshot: RevisionSnapshot): EntryInput {
  return {
    kind: snapshot.kind,
    title: snapshot.title,
    description: snapshot.description,
    notes: snapshot.notes,
    yieldText: snapshot.yieldText,
    prepTime: snapshot.prepTime,
    cookTime: snapshot.cookTime,
    ingredients: snapshot.ingredients,
    steps: snapshot.steps,
    sourceUrl: snapshot.sourceUrl,
    sourceName: snapshot.sourceName,
    tags: snapshot.tags,
    collectionIds: snapshot.collections.map((c) => c.id),
    photos: snapshot.photos ?? [],
  };
}

export type Change =
  | { field: string; label: string; type: "text"; before: string; after: string }
  | { field: string; label: string; type: "list"; removed: string[]; added: string[] };

const TEXT_FIELDS: { field: keyof RevisionSnapshot; label: string }[] = [
  { field: "kind", label: "Type" },
  { field: "title", label: "Title" },
  { field: "description", label: "Description" },
  { field: "yieldText", label: "Serves / makes" },
  { field: "prepTime", label: "Prep" },
  { field: "cookTime", label: "Cook" },
  { field: "notes", label: "Notes" },
  { field: "sourceUrl", label: "Source link" },
  { field: "sourceName", label: "Source name" },
];

/** Items in `a` missing from `b`, respecting repeats. */
function minus(a: string[], b: string[]): string[] {
  const remaining = new Map<string, number>();
  for (const item of b) remaining.set(item, (remaining.get(item) ?? 0) + 1);
  const result: string[] = [];
  for (const item of a) {
    const count = remaining.get(item) ?? 0;
    if (count > 0) remaining.set(item, count - 1);
    else result.push(item);
  }
  return result;
}

function listChange(field: string, label: string, before: string[], after: string[]): Change | null {
  const removed = minus(before, after);
  const added = minus(after, before);
  const reordered = removed.length === 0 && added.length === 0 && before.join("\n") !== after.join("\n");
  if (reordered) return { field, label: `${label} (order)`, type: "list", removed: [], added: ["Reordered"] };
  return removed.length || added.length ? { field, label, type: "list", removed, added } : null;
}

/** Field-by-field differences from `before` to `after`, for "what changed" views. */
export function diffSnapshots(before: RevisionSnapshot, after: RevisionSnapshot): Change[] {
  const changes: Change[] = [];
  for (const { field, label } of TEXT_FIELDS) {
    const a = (before[field] as string | null) ?? "";
    const b = (after[field] as string | null) ?? "";
    if (a !== b) changes.push({ field, label, type: "text", before: a, after: b });
  }
  const lists: (Change | null)[] = [
    listChange("ingredients", "Ingredients", before.ingredients.map(ingredientLine), after.ingredients.map(ingredientLine)),
    listChange("steps", "Method", before.steps, after.steps),
    listChange("tags", "Tags", before.tags, after.tags),
    listChange("collections", "Collections", before.collections.map((c) => c.name), after.collections.map((c) => c.name)),
    listChange(
      "photos",
      "Photos",
      (before.photos ?? []).map((p) => p.caption || `Photo ${p.id.slice(0, 8)}`),
      (after.photos ?? []).map((p) => p.caption || `Photo ${p.id.slice(0, 8)}`),
    ),
  ];
  for (const change of lists) if (change) changes.push(change);
  return changes;
}
