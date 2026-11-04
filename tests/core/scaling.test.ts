import { describe, expect, it } from "vitest";
import { formatAmount, isServingsYield, parseAmount, parseYield, scaleQuantity } from "../../server/core/scaling";

const scaled = (quantity: string, factor: number) => {
  const result = scaleQuantity(quantity, factor);
  return result.scalable ? result.text : `UNSCALED(${result.reason})`;
};

describe("parseAmount", () => {
  it("reads whole numbers, decimals, fractions, mixed numbers and unicode fractions", () => {
    expect(parseAmount("2")).toBe(2);
    expect(parseAmount("1.5")).toBe(1.5);
    expect(parseAmount(".5")).toBe(0.5);
    expect(parseAmount("3/4")).toBe(0.75);
    expect(parseAmount("1 1/2")).toBe(1.5);
    expect(parseAmount("1-1/2")).toBe(1.5);
    expect(parseAmount("½")).toBe(0.5);
    expect(parseAmount("1½")).toBe(1.5);
    expect(parseAmount("2 ¾")).toBe(2.75);
    expect(parseAmount("1/0")).toBeNull();
    expect(parseAmount("a few")).toBeNull();
  });
});

describe("formatAmount", () => {
  it("prints kitchen fractions in the source's style", () => {
    expect(formatAmount(1.5)).toBe("1½");
    expect(formatAmount(0.75)).toBe("¾");
    expect(formatAmount(2 / 3)).toBe("⅔");
    expect(formatAmount(4)).toBe("4");
    expect(formatAmount(2.25, "ascii")).toBe("2 1/4");
    expect(formatAmount(0.5, "ascii")).toBe("1/2");
    expect(formatAmount(0.75, "decimal")).toBe("0.75");
    expect(formatAmount(3.3333, "decimal")).toBe("3.33");
  });

  it("shows a plain decimal rather than rounding to a fraction that isn't close", () => {
    expect(formatAmount(5 / 12)).toBe("0.417");
    expect(formatAmount(1 / 16)).toBe("0.063");
  });
});

describe("scaleQuantity (AC-054, AC-060)", () => {
  it("scales a leading amount and keeps the unit and words exactly", () => {
    expect(scaled("6 oz", 2)).toBe("12 oz");
    expect(scaled("2 tbsp", 1.5)).toBe("3 tbsp");
    expect(scaled("3 large", 0.5)).toBe("1½ large");
    expect(scaled("about 2 cups", 2)).toBe("about 4 cups");
    expect(scaled("1.5 lb", 2)).toBe("3 lb");
  });

  it("handles fractions in ASCII and unicode", () => {
    expect(scaled("1/2 cup", 2)).toBe("1 cup");
    expect(scaled("1 1/2 cups", 2)).toBe("3 cups");
    expect(scaled("3/4 cup", 2)).toBe("1 1/2 cup");
    expect(scaled("½ tsp", 3)).toBe("1½ tsp");
    expect(scaled("1⅓ cups", 0.5)).toBe("⅔ cups");
    expect(scaled("⅓ cup", 1.5)).toBe("½ cup");
  });

  it("scales both ends of a range and keeps the separator", () => {
    expect(scaled("2-3 tbsp", 2)).toBe("4-6 tbsp");
    expect(scaled("2–3", 2)).toBe("4–6");
    expect(scaled("1 to 2 cloves", 3)).toBe("3 to 6 cloves");
    expect(scaled("½-1 tsp", 2)).toBe("1-2 tsp");
  });

  it("flags unknown amounts and leaves them exactly as written", () => {
    expect(scaleQuantity("", 2)).toEqual({ scalable: false, text: "", reason: "no_amount" });
    expect(scaleQuantity("to taste", 2)).toEqual({ scalable: false, text: "to taste", reason: "not_a_number" });
    expect(scaleQuantity("a pinch", 2)).toEqual({ scalable: false, text: "a pinch", reason: "not_a_number" });
    expect(scaleQuantity("a handful", 0.5)).toMatchObject({ scalable: false, text: "a handful" });
  });

  it("never guesses when more than one number is involved", () => {
    expect(scaled("1 cup plus 2 tbsp", 2)).toBe("UNSCALED(several_numbers)");
    expect(scaled("2 (14 oz) cans", 2)).toBe("UNSCALED(several_numbers)");
    expect(scaled("juice of 1 lemon", 2)).toBe("UNSCALED(several_numbers)");
  });

  it("returns the original text untouched at ×1", () => {
    expect(scaleQuantity("1 1/2 cups ", 1)).toEqual({ scalable: true, text: "1 1/2 cups ", changed: false });
  });
});

describe("parseYield (AC-060: missing yield is never inferred)", () => {
  it("reads a single whole number", () => {
    expect(parseYield("Serves 4")).toEqual({ kind: "count", count: 4 });
    expect(parseYield("4 servings")).toEqual({ kind: "count", count: 4 });
    expect(parseYield("Makes 12 cookies")).toEqual({ kind: "count", count: 12 });
  });

  it("treats missing, ranged, fractional or wordy yields as unknown", () => {
    expect(parseYield(null)).toEqual({ kind: "none" });
    expect(parseYield("  ")).toEqual({ kind: "none" });
    expect(parseYield("4–6 servings")).toEqual({ kind: "unclear" });
    expect(parseYield("4 to 6")).toEqual({ kind: "unclear" });
    expect(parseYield("1½ cups")).toEqual({ kind: "unclear" });
    expect(parseYield("a big pot")).toEqual({ kind: "unclear" });
  });

  it("labels people/portion yields as servings", () => {
    expect(isServingsYield("Serves 4")).toBe(true);
    expect(isServingsYield("4 portions")).toBe(true);
    expect(isServingsYield("12 cookies")).toBe(false);
  });
});
