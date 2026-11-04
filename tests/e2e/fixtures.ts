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
  /** A signed-in non-admin ("Pat Example") with a profile picture. */
  viewerCookie: { name: string; value: string };
  freshCookie: { name: string; value: string };
}

export function fixtures(): Fixtures {
  return JSON.parse(readFileSync(`${E2E.dir}/fixtures.json`, "utf8"));
}

export async function signInAsViewer(context: BrowserContext) {
  const { viewerCookie: c } = fixtures();
  await context.addCookies([{ name: c.name, value: c.value, url: E2E.baseURL, httpOnly: true, sameSite: "Lax" }]);
}

export async function signInAsAdmin(context: BrowserContext, instance: "main" | "fresh" = "main") {
  const { cookie, freshCookie } = fixtures();
  const [c, url] = instance === "fresh" ? [freshCookie, E2E.fresh.baseURL] : [cookie, E2E.baseURL];
  await context.addCookies([{ name: c.name, value: c.value, url, httpOnly: true, sameSite: "Lax" }]);
}

/**
 * A real JPEG made by the browser's canvas, with an EXIF/GPS block spliced in
 * after the start marker (what a phone photo carries).
 */
export async function jpegWithGps(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#c98b5b";
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = "#3f6b3a";
    ctx.fillRect(160, 120, 320, 240);
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1]!;
  });
  const jpeg = Buffer.from(base64, "base64");
  const payload = Buffer.from("Exif\0\0MM\0*GPSLatitude 37.7749 N GPSLongitude 122.4194 W", "latin1");
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** True for the phone projects, where Review and Import live in the account menu (E2). */
export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 600;

/**
 * Follows an admin top-bar link (Review, Import). On phones those live in the
 * account menu, so this opens it first.
 */
export async function clickAdminLink(page: Page, name: string | RegExp) {
  if (isPhone(page)) await page.getByRole("banner").getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("banner").getByRole("link", { name, exact: typeof name === "string" }).filter({ visible: true }).click();
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
