// Imports (M5): the shape of an extracted draft, reading schema.org Recipe
// data from web pages, and turning HTML into plain text. Pure logic.
import type { Ingredient } from "./recipes";

/** What an import produces. The admin reviews it in the editor before anything is saved. */
export interface RecipeDraft {
  kind: "recipe" | "idea";
  title: string;
  description: string | null;
  yieldText: string | null;
  prepTime: string | null;
  cookTime: string | null;
  ingredients: Ingredient[];
  steps: string[];
  notes: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  /** Parts the extractor wasn't sure about, in plain words, shown to the admin. */
  uncertain: string[];
  /** More recipes were found in the input than the one extracted (imports are one at a time, D12). */
  otherRecipes: number;
}

export const MAX_IMPORT_TEXT = 60_000;

// ---------- Text helpers ----------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  deg: "°",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const clean = (value: unknown): string => decodeEntities(String(value ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Readable text from a web page, for AI extraction when the page has no recipe data. */
export function htmlToText(html: string, maxLength = 40_000): string {
  const text = html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxLength);
}

export function pageTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)?.[1];
  return og ? clean(og) : null;
}

// ---------- schema.org Recipe (JSON-LD) ----------

/** "PT1H20M" → "1 hr 20 min". Returns null for anything unrecognized. */
export function humanDuration(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const match = iso.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0) + days * 24;
  const minutes = Number(match[3] ?? 0);
  const parts = [hours ? `${hours} hr` : "", minutes ? `${minutes} min` : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

const UNIT =
  "(?:cups?|c\\.|tbsp\\.?|tablespoons?|tbs\\.?|tsp\\.?|teaspoons?|oz\\.?|ounces?|fl\\.? oz\\.?|lbs?\\.?|pounds?|g|grams?|kg|kilograms?|mg|ml|milliliters?|millilitres?|l|liters?|litres?|cloves?|cans?|tins?|pinch(?:es)?|dash(?:es)?|sticks?|slices?|pieces?|bunch(?:es)?|sprigs?|heads?|packages?|pkgs?\\.?|quarts?|qts?\\.?|pints?|pts?\\.?|large|medium|small)";
const AMOUNT = "(?:\\d+(?:[.,]\\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\\s*[¼½¾⅓⅔⅛⅜⅝⅞]|\\s+\\d+\\/\\d+|\\/\\d+)?";
const LEADING_QUANTITY = new RegExp(`^((?:${AMOUNT})(?:\\s*(?:-|–|to)\\s*(?:${AMOUNT}))?(?:\\s*${UNIT}\\b)?)\\s+(.+)$`, "i");

/** Splits "1½ tbsp gochujang" into quantity and item, keeping the original text exactly. */
export function splitIngredientLine(line: string): Ingredient {
  const text = line.replace(/\s+/g, " ").trim();
  const match = text.match(LEADING_QUANTITY);
  return match ? { quantity: match[1]!.trim(), item: match[2]!.trim() } : { quantity: "", item: text };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function isRecipe(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== "object") return false;
  return asArray((node as Record<string, unknown>)["@type"]).some((t) => String(t).toLowerCase() === "recipe");
}

function findRecipes(node: unknown, found: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (depth > 6 || !node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const item of node) findRecipes(item, found, depth + 1);
    return found;
  }
  if (isRecipe(node)) found.push(node);
  const record = node as Record<string, unknown>;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    if (record[key]) findRecipes(record[key], found, depth + 1);
  }
  return found;
}

function instructionSteps(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === "string") {
    const text = decodeEntities(value.replace(/<\/?(p|li|br)[^>]*>/gi, "\n").replace(/<[^>]*>/g, ""));
    return text.split(/\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  }
  return asArray(value).flatMap((item) => {
    if (typeof item === "string") return instructionSteps(item, depth + 1);
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (record.itemListElement) return instructionSteps(record.itemListElement, depth + 1); // HowToSection
    const text = clean(record.text ?? record.name ?? "");
    return text ? [text] : [];
  });
}

function yieldText(value: unknown): string | null {
  const values = asArray(value).map(clean).filter(Boolean);
  if (values.length === 0) return null;
  const best = values.find((v) => /\D/.test(v)) ?? values[0]!;
  return /^\d+$/.test(best) ? `Serves ${best}` : best;
}

/** Reads a schema.org Recipe from the page's JSON-LD, if present. Free and exact: no AI involved. */
export function extractJsonLdRecipe(html: string, url: string): RecipeDraft | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const recipes: Record<string, unknown>[] = [];
  for (const block of blocks) {
    try {
      findRecipes(JSON.parse(block[1]!.trim()), recipes);
    } catch {
      // Ignore malformed blocks; other blocks may still have the recipe.
    }
  }
  const recipe = recipes[0];
  if (!recipe) return null;
  const title = clean(recipe.name);
  const ingredients = asArray(recipe.recipeIngredient ?? recipe.ingredients)
    .map(clean)
    .filter(Boolean)
    .map(splitIngredientLine);
  if (!title || (ingredients.length === 0 && !recipe.recipeInstructions)) return null;
  let host: string | null = null;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = null;
  }
  return {
    kind: "recipe",
    title,
    description: clean(recipe.description) || null,
    yieldText: yieldText(recipe.recipeYield),
    prepTime: humanDuration(recipe.prepTime),
    cookTime: humanDuration(recipe.cookTime) ?? (recipe.prepTime ? null : humanDuration(recipe.totalTime)),
    ingredients,
    steps: instructionSteps(recipe.recipeInstructions),
    notes: null,
    sourceUrl: url,
    sourceName: pageTitle(html) ?? host,
    uncertain: [],
    otherRecipes: Math.max(0, recipes.length - 1),
  };
}
