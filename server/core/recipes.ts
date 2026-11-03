// Catalog entry rules. Pure logic: no framework, host, or database imports.
import { z } from "zod";

export type EntryKind = "recipe" | "idea";
export type EntryOrigin = "manual" | "web" | "image" | "paste" | "ai";

export interface Ingredient {
  /** Original amount text, kept verbatim ("1½ tbsp", "2–3", ""). */
  quantity: string;
  item: string;
}

/** A photo shown with an entry, in display order. */
export interface PhotoRef {
  id: string;
  caption: string;
}

export interface EntryInput {
  kind: EntryKind;
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
  collectionIds: string[];
  photos: PhotoRef[];
}

export interface NamedRef {
  id: string;
  name: string;
}

export interface Entry extends Omit<EntryInput, "tags" | "collectionIds"> {
  id: string;
  origin: EntryOrigin;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  tags: NamedRef[];
  collections: NamedRef[];
}

export interface EntrySummary {
  id: string;
  kind: EntryKind;
  title: string;
  yieldText: string | null;
  prepTime: string | null;
  cookTime: string | null;
  /** First few ingredient names, for entries shown without a photo. */
  ingredientPreview: string[];
  /** The first photo, shown as the catalog thumbnail. */
  coverPhoto: PhotoRef | null;
  tags: string[];
  updatedAt: Date;
  deletedAt: Date | null;
}

export const LIMITS = {
  title: 200,
  shortText: 120,
  longText: 10_000,
  url: 2_000,
  ingredients: 200,
  steps: 200,
  tags: 30,
  collections: 30,
  photos: 20,
  caption: 200,
} as const;

const photoId = z.string().regex(/^[0-9a-f-]{36}$/i, "Invalid photo");

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim())
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

const httpUrl = z
  .string()
  .trim()
  .max(LIMITS.url)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null)
  .refine((value) => value === null || /^https?:\/\/[^\s]+$/i.test(value), "Enter a link starting with http:// or https://");

const entrySchema = z.object({
  kind: z.enum(["recipe", "idea"]),
  title: z
    .string()
    .trim()
    .min(1, "Give it a title")
    .max(LIMITS.title, `Keep the title under ${LIMITS.title} characters`),
  description: optionalText(LIMITS.longText),
  notes: optionalText(LIMITS.longText),
  yieldText: optionalText(LIMITS.shortText),
  prepTime: optionalText(LIMITS.shortText),
  cookTime: optionalText(LIMITS.shortText),
  ingredients: z
    .array(z.object({ quantity: z.string().max(LIMITS.shortText), item: z.string().max(LIMITS.shortText * 4) }))
    .max(LIMITS.ingredients, `At most ${LIMITS.ingredients} ingredients`)
    .transform((rows) =>
      rows
        .map((row) => ({ quantity: row.quantity.trim(), item: row.item.trim() }))
        .filter((row) => row.quantity.length > 0 || row.item.length > 0),
    ),
  steps: z
    .array(z.string().max(LIMITS.longText))
    .max(LIMITS.steps, `At most ${LIMITS.steps} steps`)
    .transform((steps) => steps.map((step) => step.trim()).filter((step) => step.length > 0)),
  sourceUrl: httpUrl,
  sourceName: optionalText(LIMITS.shortText),
  tags: z.array(z.string().max(60)).max(LIMITS.tags, `At most ${LIMITS.tags} tags`).transform(normalizeTagNames),
  collectionIds: z
    .array(z.string().max(64))
    .max(LIMITS.collections)
    .transform((ids) => [...new Set(ids.filter((id) => id.length > 0))]),
  photos: z
    .array(z.object({ id: photoId, caption: z.string().max(LIMITS.caption, `Keep captions under ${LIMITS.caption} characters`) }))
    .max(LIMITS.photos, `At most ${LIMITS.photos} photos`)
    .optional()
    .transform((list) => {
      const seen = new Set<string>();
      return (list ?? [])
        .map((photo) => ({ id: photo.id.toLowerCase(), caption: photo.caption.trim() }))
        .filter((photo) => (seen.has(photo.id) ? false : (seen.add(photo.id), true)));
    }),
});

export type FieldErrors = Partial<Record<keyof EntryInput | "form", string>>;

export type ValidationResult = { ok: true; value: EntryInput } | { ok: false; errors: FieldErrors };

/** Validates and normalizes editor input. Never invents missing details. */
export function validateEntry(raw: unknown): ValidationResult {
  const parsed = entrySchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = (issue.path[0] as keyof EntryInput | undefined) ?? "form";
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Trims, collapses spaces, drops empties and case-insensitive duplicates (first spelling wins). */
export function normalizeTagNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    const key = name.toLowerCase();
    if (name.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/** Splits a comma-separated tag field. */
export function parseTagList(value: string): string[] {
  return normalizeTagNames(value.split(","));
}

/** Plain text of ingredients for the full-text index. */
export function ingredientSearchText(ingredients: readonly Ingredient[]): string {
  return ingredients.map((row) => `${row.quantity} ${row.item}`.trim()).join("\n");
}

export function ingredientLine(row: Ingredient): string {
  return `${row.quantity} ${row.item}`.trim();
}

/**
 * Builds a safe FTS5 query from what a visitor typed: each word becomes a
 * quoted prefix term, all terms required. Returns null when nothing is
 * searchable. Quotes are stripped so input can never inject FTS syntax.
 */
export function buildSearchQuery(input: string): string | null {
  const terms = input
    .normalize("NFKC")
    .replace(/["*^:(){}[\]]/g, " ")
    .split(/\s+/)
    .map((term) => term.replace(/^[-+]+/, "").trim())
    .filter((term) => term.length > 0)
    .slice(0, 8);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"*`).join(" AND ");
}

/**
 * Converts free-text times like "10 min", "1 hr 20 min", "1h30m" or "45 minutes"
 * to ISO 8601 durations for schema.org. Returns null when unsure.
 */
export function toIsoDuration(text: string | null): string | null {
  if (!text) return null;
  const value = text.toLowerCase().trim();
  const match = value.match(/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = (match[2] ? Number(match[2]) : 0) + Math.round((hours % 1) * 60);
  const wholeHours = Math.floor(hours);
  if (wholeHours === 0 && minutes === 0) return null;
  return `PT${wholeHours ? `${wholeHours}H` : ""}${minutes ? `${minutes}M` : ""}`;
}

/** schema.org Recipe data for a recipe page (used by Lose It!'s URL importer). */
export function toSchemaOrgRecipe(entry: Entry, pageUrl: string): Record<string, unknown> | null {
  if (entry.kind !== "recipe") return null;
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: entry.title,
    url: pageUrl,
    dateModified: entry.updatedAt.toISOString(),
  };
  if (entry.description) data.description = entry.description;
  if (entry.yieldText) data.recipeYield = entry.yieldText;
  const prep = toIsoDuration(entry.prepTime);
  const cook = toIsoDuration(entry.cookTime);
  if (prep) data.prepTime = prep;
  if (cook) data.cookTime = cook;
  if (entry.ingredients.length > 0) data.recipeIngredient = entry.ingredients.map(ingredientLine);
  if (entry.steps.length > 0) {
    data.recipeInstructions = entry.steps.map((text, index) => ({ "@type": "HowToStep", position: index + 1, text }));
  }
  if (entry.tags.length > 0) data.keywords = entry.tags.map((tag) => tag.name).join(", ");
  return data;
}

/** Serializes JSON for a <script type="application/ld+json"> block without allowing "</script>". */
export function jsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
