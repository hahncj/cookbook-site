// Shared representation of catalog entries for AI tools (MCP and HTTP API),
// so both interfaces return exactly the same data (AC-025).
import type { Entry, EntrySummary } from "./core/recipes";

/** A full entry, in the same field names tools use to submit (so they can round-trip it). */
export function recipeForTools(entry: Entry, baseUrl: string) {
  return {
    id: entry.id,
    revision: entry.revision,
    url: `${baseUrl}/recipes/${entry.id}`,
    kind: entry.kind,
    title: entry.title,
    description: entry.description,
    notes: entry.notes,
    servings: entry.yieldText,
    prepTime: entry.prepTime,
    cookTime: entry.cookTime,
    ingredients: entry.ingredients,
    steps: entry.steps,
    sourceUrl: entry.sourceUrl,
    sourceName: entry.sourceName,
    tags: entry.tags.map((tag) => tag.name),
    collections: entry.collections.map((c) => c.name),
    photoCount: entry.photos.length,
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export function summaryForTools(entry: EntrySummary, baseUrl: string) {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    url: `${baseUrl}/recipes/${entry.id}`,
    tags: entry.tags,
    updatedAt: entry.updatedAt.toISOString(),
  };
}
