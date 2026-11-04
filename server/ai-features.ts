// In-app AI features (M5). Callers must check admin access BEFORE calling
// these, so no paid provider call happens for anyone else (AC-066/067).
import type { Services } from "./app";
import type { AiResult, ImageInput } from "./core/ai";
import { detectImageType } from "./core/images";
import { MAX_IMPORT_TEXT, extractJsonLdRecipe, htmlToText, type RecipeDraft } from "./core/imports";
import type { DuplicateMatch } from "./core/duplicates";
import { z } from "zod";
import { readPhotoBytes } from "./photos";

export const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IDENTIFY_IMAGES = 4;

export type ImportSource = "paste" | "web" | "image";

export type ImportOutcome =
  | { ok: true; draft: RecipeDraft; origin: ImportSource; method: "structured" | "ai"; duplicates: DuplicateMatch[] }
  | { ok: false; message: string };

const MEDIA_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/** Checks the bytes really are a supported image. */
export function toImageInput(bytes: Uint8Array): ImageInput | { message: string } {
  if (bytes.length === 0) return { message: "No photo was received." };
  if (bytes.length > MAX_AI_IMAGE_BYTES) return { message: "That photo is too large to analyze (5 MB maximum)." };
  const type = detectImageType(bytes);
  if (!type) return { message: "That file isn't a JPEG, PNG or WebP image." };
  return { data: bytes, mediaType: MEDIA_TYPES[type] };
}

async function withDuplicates(services: Services, draft: RecipeDraft, origin: ImportSource, method: "structured" | "ai"): Promise<ImportOutcome> {
  const duplicates = await services.catalog.findSimilar({ title: draft.title, ingredients: draft.ingredients.map((i) => i.item) });
  return { ok: true, draft, origin, method, duplicates };
}

function fromAi(result: AiResult<RecipeDraft>): { ok: true; draft: RecipeDraft } | { ok: false; message: string } {
  if (result.ok) return { ok: true, draft: result.value };
  if (result.reason === "no_recipe") return { ok: false, message: "No recipe was found. Nothing was made up; check the input and try again." };
  return { ok: false, message: result.message };
}

export async function importFromText(services: Services, text: string): Promise<ImportOutcome> {
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  if (!trimmed) return { ok: false, message: "Paste the recipe text first." };
  if (trimmed.length > MAX_IMPORT_TEXT) return { ok: false, message: "That's too much text for one recipe. Paste just the recipe you want." };
  const result = fromAi(await services.ai.extractRecipe({ text: trimmed }));
  return result.ok ? withDuplicates(services, result.draft, "paste", "ai") : result;
}

/** Link import: the page's own recipe data first (free), Claude only as a fallback. */
export async function importFromLink(services: Services, url: string): Promise<ImportOutcome> {
  if (!url.trim()) return { ok: false, message: "Enter the recipe's web address first." };
  const page = await services.fetchPage(url);
  if (!page.ok) return page;
  const structured = extractJsonLdRecipe(page.html, page.url);
  if (structured) return withDuplicates(services, structured, "web", "structured");
  const text = htmlToText(page.html);
  if (text.length < 80) return { ok: false, message: "The page had no readable recipe. It may need a sign-in or load its content with scripts. Try Paste instead." };
  const result = fromAi(await services.ai.extractRecipe({ text, sourceUrl: page.url }));
  if (!result.ok) return result;
  return withDuplicates(services, { ...result.draft, sourceUrl: page.url }, "web", "ai");
}

export async function importFromImage(services: Services, bytes: Uint8Array): Promise<ImportOutcome> {
  const image = toImageInput(bytes);
  if ("message" in image) return { ok: false, message: image.message };
  const result = fromAi(await services.ai.extractRecipe({ image }));
  return result.ok ? withDuplicates(services, result.draft, "image", "ai") : result;
}

/** Collects up to four images from uploads and saved photo ids. */
export async function gatherImages(services: Services, uploads: Uint8Array[], photoIds: string[]): Promise<ImageInput[] | { message: string }> {
  const images: ImageInput[] = [];
  for (const bytes of uploads) {
    const image = toImageInput(bytes);
    if ("message" in image) return image;
    images.push(image);
  }
  for (const id of photoIds) {
    if (images.length >= MAX_IDENTIFY_IMAGES) break;
    const stored = await readPhotoBytes(services, id);
    if (!stored) continue;
    const image = toImageInput(stored.bytes);
    if (!("message" in image)) images.push(image);
  }
  return images.slice(0, MAX_IDENTIFY_IMAGES);
}

/** Plain text of a recipe for an AI comparison. */
export function recipeText(r: { title: string; ingredients: { quantity: string; item: string }[]; steps: string[] }): string {
  return [
    `Title: ${r.title}`,
    "Ingredients:",
    ...r.ingredients.map((i) => `- ${[i.quantity, i.item].filter(Boolean).join(" ")}`),
    "Steps:",
    ...r.steps.map((s, n) => `${n + 1}. ${s}`),
  ]
    .join("\n")
    .slice(0, 20_000);
}

const writtenSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1_000).nullable(),
  yieldText: z.string().max(120).nullable(),
  prepTime: z.string().max(120).nullable(),
  cookTime: z.string().max(120).nullable(),
  ingredients: z.array(z.object({ quantity: z.string().max(120), item: z.string().max(120) })).max(200),
  steps: z.array(z.string().max(2_000)).max(200),
  notes: z.string().max(2_000).nullable(),
});

/**
 * An AI-written recipe from "Find new recipes" (M7, D19), sent back by the
 * browser when the owner chooses "Save to cookbook". It only fills the
 * editor; the owner reviews it and presses Save (D2).
 */
export function writtenToDraft(json: string): RecipeDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = writtenSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    kind: "recipe",
    title: r.title,
    description: r.description,
    yieldText: r.yieldText,
    prepTime: r.prepTime,
    cookTime: r.cookTime,
    ingredients: r.ingredients,
    steps: r.steps,
    notes: r.notes,
    sourceUrl: null,
    sourceName: "Written by AI (Claude)",
    uncertain: [],
    otherRecipes: 0,
  };
}
