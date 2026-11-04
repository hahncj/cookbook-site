// Free duplicate detection (D8): word overlap between titles and ingredient
// lists. Suggests possible matches; it never merges or deletes anything
// (AC-057). An AI comparison is only run on request.

const STOPWORDS = new Set([
  "a", "an", "and", "the", "with", "of", "in", "on", "for", "to", "my", "our", "easy", "best", "quick", "simple",
  "homemade", "recipe", "style", "or", "&", "fresh", "chopped", "minced", "sliced", "diced", "large", "small",
  "medium", "to", "taste", "optional", "divided", "plus", "more", "about", "into", "cut", "finely", "thinly",
]);

/** Lowercase word stems: drops filler words, plurals and punctuation. */
export function keywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
    .map(singular);
  return new Set(words);
}

/** "berries" → "berry", "tomatoes" → "tomato", "dishes" → "dish", "noodles" → "noodle". */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(s|x|z|ch|sh|o)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function overlap(a: Set<string>, b: Set<string>): { shared: string[]; score: number } {
  if (a.size === 0 || b.size === 0) return { shared: [], score: 0 };
  const shared = [...a].filter((word) => b.has(word));
  return { shared, score: shared.length / Math.min(a.size, b.size) };
}

export interface DuplicateInput {
  title: string;
  ingredients: string[];
}

export interface DuplicateCandidate extends DuplicateInput {
  id: string;
}

export interface DuplicateMatch {
  id: string;
  title: string;
  score: number;
  reasons: string[];
}

/** Scores how similar two entries look. 0 = unrelated, 1 = same title and ingredients. */
export function similarity(a: DuplicateInput, b: DuplicateInput): { score: number; reasons: string[] } {
  const titles = overlap(keywords(a.title), keywords(b.title));
  const ingredients = overlap(keywords(a.ingredients.join(" ")), keywords(b.ingredients.join(" ")));
  const hasIngredients = a.ingredients.length > 0 && b.ingredients.length > 0;
  const score = hasIngredients ? titles.score * 0.6 + ingredients.score * 0.4 : titles.score;
  const reasons: string[] = [];
  if (titles.shared.length) reasons.push(`Title shares “${titles.shared.slice(0, 4).join(", ")}”`);
  if (hasIngredients && ingredients.shared.length >= 2) reasons.push(`${ingredients.shared.length} ingredients in common`);
  return { score: Math.round(score * 100) / 100, reasons };
}

export const DUPLICATE_THRESHOLD = 0.5;

/** The likeliest matches among candidates, best first. */
export function findDuplicates(draft: DuplicateInput, candidates: DuplicateCandidate[], limit = 3): DuplicateMatch[] {
  return candidates
    .map((candidate) => ({ id: candidate.id, title: candidate.title, ...similarity(draft, candidate) }))
    .filter((match) => match.score >= DUPLICATE_THRESHOLD)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

/** An FTS5 query matching ANY of the title's keywords, to fetch a candidate pool cheaply. */
export function anyKeywordQuery(title: string): string | null {
  const words = [...keywords(title)].slice(0, 8);
  // Stems like "berry" (from "berries") must still prefix-match the stored words.
  const prefixes = words.map((w) => (w.length > 3 && w.endsWith("y") ? w.slice(0, -1) : w));
  return prefixes.length ? prefixes.map((w) => `"${w}"*`).join(" OR ") : null;
}
