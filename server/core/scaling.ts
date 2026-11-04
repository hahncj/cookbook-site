// Serving adjustment (workflow 11, AC-054, AC-060). Pure logic that runs in
// the browser: the saved recipe is never changed, and nothing here is
// guessed. Only a clear leading amount (a number, fraction or range) is
// scaled; anything else is shown as written and flagged for the cook.

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 1 / 2,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅕": 1 / 5,
  "⅖": 2 / 5,
  "⅗": 3 / 5,
  "⅘": 4 / 5,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};
const VULGAR = Object.keys(UNICODE_FRACTIONS).join("");

/** Fractions printed when a scaled amount lands on (or very near) one. */
const NICE_FRACTIONS: { value: number; unicode: string; ascii: string }[] = [
  [1, 8, "⅛"],
  [1, 6, "⅙"],
  [1, 4, "¼"],
  [1, 3, "⅓"],
  [3, 8, "⅜"],
  [1, 2, "½"],
  [5, 8, "⅝"],
  [2, 3, "⅔"],
  [3, 4, "¾"],
  [5, 6, "⅚"],
  [7, 8, "⅞"],
].map(([n, d, unicode]) => ({ value: (n as number) / (d as number), unicode: unicode as string, ascii: `${n}/${d}` }));

// One amount: "1 1/2", "1-1/2", "1½", "1 ½", "3/4", "½", "1.5", "2".
const NUMBER = `(?:\\d+(?:\\s+|-)\\d+\\/\\d+|\\d+\\/\\d+|\\d+\\s*[${VULGAR}]|[${VULGAR}]|\\d+(?:\\.\\d+)?|\\.\\d+)`;
const RANGE_SEPARATOR = `\\s*(?:-|–|—|to|or)\\s*`;
const PREFIX = `(?:about|approx\\.?|approximately|around|roughly|~|scant|heaping|heaped|generous|up to)\\s*`;
const LEADING_AMOUNT = new RegExp(`^(${PREFIX})?(${NUMBER})(?:(${RANGE_SEPARATOR})(${NUMBER}))?(?![\\d/.${VULGAR}])`, "i");
const HAS_NUMBER = new RegExp(`[\\d${VULGAR}]`);

type Style = "unicode" | "ascii" | "decimal";

/** Parses one amount token (see NUMBER). Returns null when it isn't a usable positive number. */
export function parseAmount(token: string): number | null {
  const text = token.trim();
  let match = text.match(/^(\d+)(?:\s+|-)(\d+)\/(\d+)$/);
  if (match) {
    const denominator = Number(match[3]);
    return denominator > 0 ? Number(match[1]) + Number(match[2]) / denominator : null;
  }
  match = text.match(/^(\d+)\/(\d+)$/);
  if (match) {
    const denominator = Number(match[2]);
    return denominator > 0 ? Number(match[1]) / denominator : null;
  }
  match = text.match(new RegExp(`^(\\d*)\\s*([${VULGAR}])$`));
  if (match) return Number(match[1] || 0) + UNICODE_FRACTIONS[match[2]!]!;
  if (/^(\d+(\.\d+)?|\.\d+)$/.test(text)) return Number(text);
  return null;
}

function styleOf(token: string): Style {
  if (token.includes("/")) return "ascii";
  if (token.includes(".")) return "decimal";
  return "unicode";
}

function trimDecimal(value: number, places: number) {
  return String(Number(value.toFixed(places)));
}

/** Prints an amount the way a cook would read it: ½, 1⅓, 2 1/4 or 0.75. */
export function formatAmount(value: number, style: Style = "unicode"): string {
  if (style === "decimal") return trimDecimal(value, value < 1 ? 3 : 2);
  const whole = Math.floor(value + 0.0001);
  const rest = value - whole;
  if (rest < 0.02) return String(whole);
  if (rest > 0.98) return String(whole + 1);
  let best = NICE_FRACTIONS[0]!;
  for (const fraction of NICE_FRACTIONS) {
    if (Math.abs(fraction.value - rest) < Math.abs(best.value - rest)) best = fraction;
  }
  // Not close to a kitchen fraction (e.g. 1/16 or 5/12): show a plain decimal instead of rounding it away.
  if (Math.abs(best.value - rest) > 0.015) return trimDecimal(value, value < 1 ? 3 : 2);
  if (style === "ascii") return whole > 0 ? `${whole} ${best.ascii}` : best.ascii;
  return whole > 0 ? `${whole}${best.unicode}` : best.unicode;
}

export type UnscalableReason = "no_amount" | "not_a_number" | "several_numbers";

export type ScaledQuantity =
  | { scalable: true; text: string; changed: boolean }
  | { scalable: false; text: string; reason: UnscalableReason };

/**
 * Scales one ingredient's quantity text by `factor`. Only a single leading
 * amount or range is changed; the unit and any other words are kept exactly.
 * Blank, wordy ("to taste", "a pinch") and multi-number ("1 cup plus 2 tbsp",
 * "2 (14 oz) cans") quantities are returned unchanged and marked unscalable.
 */
export function scaleQuantity(quantity: string, factor: number): ScaledQuantity {
  const text = quantity.trim();
  if (!text) return { scalable: false, text: quantity, reason: "no_amount" };
  const match = text.match(LEADING_AMOUNT);
  if (!match) return { scalable: false, text: quantity, reason: HAS_NUMBER.test(text) ? "several_numbers" : "not_a_number" };
  const [whole, prefix = "", first, separator, second] = match;
  const rest = text.slice(whole.length);
  if (HAS_NUMBER.test(rest)) return { scalable: false, text: quantity, reason: "several_numbers" };
  const low = parseAmount(first!);
  const high = second ? parseAmount(second) : null;
  if (low === null || low <= 0 || (second && (high === null || high <= 0))) {
    return { scalable: false, text: quantity, reason: "not_a_number" };
  }
  if (factor === 1) return { scalable: true, text: quantity, changed: false };
  const scaledLow = formatAmount(low * factor, styleOf(first!));
  const amount = second ? `${scaledLow}${separator}${formatAmount(high! * factor, styleOf(second))}` : scaledLow;
  return { scalable: true, text: `${prefix}${amount}${rest}`, changed: true };
}

export type ParsedYield =
  | { kind: "count"; count: number }
  | { kind: "none" }
  | { kind: "unclear" };

/**
 * Reads how many a recipe makes from its yield text ("Serves 4", "12
 * cookies"). Missing yield is never inferred; a range ("4–6 servings"), a
 * fraction or text without a number is "unclear", and the cook scales by a
 * multiple instead.
 */
export function parseYield(yieldText: string | null | undefined): ParsedYield {
  const text = yieldText?.trim() ?? "";
  if (!text) return { kind: "none" };
  const numbers = text.match(new RegExp(`${NUMBER}(?:${RANGE_SEPARATOR}${NUMBER})?`, "gi")) ?? [];
  const first = numbers[0];
  if (!first || !/^\d+$/.test(first.trim())) return { kind: "unclear" };
  const count = Number(first);
  return count > 0 && count <= 1000 ? { kind: "count", count } : { kind: "unclear" };
}

/** True when the yield is about people/portions, so the control reads "Servings"; otherwise "Makes". */
export function isServingsYield(yieldText: string | null | undefined): boolean {
  return /serv|portion|people|person|persons/i.test(yieldText ?? "");
}

export const MULTIPLIERS = [0.5, 1, 1.5, 2, 3] as const;
export const MAX_SERVINGS = 99;

export function multiplierLabel(factor: number): string {
  return `×${formatAmount(factor, "unicode")}`;
}
