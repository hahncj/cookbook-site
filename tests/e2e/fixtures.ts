import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { E2E } from "../../playwright.config";

export interface Fixtures {
  recipeId: string;
  longId: string;
  ideaId: string;
  cookie: { name: string; value: string };
}

export function fixtures(): Fixtures {
  return JSON.parse(readFileSync(`${E2E.dir}/fixtures.json`, "utf8"));
}

export async function signInAsAdmin(context: BrowserContext) {
  const { cookie } = fixtures();
  await context.addCookies([{ name: cookie.name, value: cookie.value, url: E2E.baseURL, httpOnly: true, sameSite: "Lax" }]);
}

/** AC-026: the page never scrolls sideways. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(0);
}

/** AC-037/AC-072: no serious or critical accessibility problems (includes color contrast). */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`),
    "accessibility violations",
  ).toEqual([]);
}
