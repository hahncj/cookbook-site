import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, jpegWithGps, signInAsAdmin } from "./fixtures";

/**
 * The photo searches are answered by the local mock (tests/e2e/mock-anthropic.mjs).
 * Their images live on a .test host, so the browser is served a local JPEG for
 * them. The download step (/api/photos/fetch) can't reach that host from the
 * server either, so it is answered the same way; its SSRF guard and admin
 * checks are covered by tests/server/e1.test.ts. Interception is switched off
 * once the download is answered: WebKit drops multipart upload bodies while
 * Playwright intercepts requests, and the upload to /api/photos comes next.
 */
async function serveFoundImages(page: Page) {
  await page.goto("/");
  const jpeg = await jpegWithGps(page);
  await page.route("https://images.e2e.test/**", (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: jpeg }));
  await page.route("**/api/photos/fetch", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/jpeg", body: jpeg });
    await page.unrouteAll();
  });
}

async function createKey(page: Page, name: string) {
  await page.goto("/settings");
  await page.getByLabel("New key name").fill(name);
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.locator(".notice code").textContent())!.trim();
  expect(key).toMatch(/^ck_/);
  return key;
}

test.describe("Find a photo (E1)", () => {
  test("editor: pick a stock photo, save, and the credit shows with the recipe", async ({ page, context }) => {
    await signInAsAdmin(context);
    await serveFoundImages(page);
    const title = `Tomato Soup ${test.info().project.name} ${Date.now()}`;
    await page.goto("/recipes/new");
    await page.getByLabel("Title").fill(title);

    await page.getByRole("button", { name: "Find a photo" }).click();
    const choices = page.getByRole("group", { name: "Photo choices" });
    const stock = choices.getByRole("button", { name: /Stock photo: Tomato Soup/ });
    await expect(stock).toBeVisible();
    await expect(stock).toContainText("Photo: Jane Doe / Pixabay");
    await expect(choices.getByRole("button", { name: "Use this photo" })).toBeDisabled();

    // Secondary source on request, labeled as from the web.
    await choices.getByRole("button", { name: "Search the web for more" }).click();
    await expect(choices.getByRole("button", { name: /Web photo of Tomato Soup/ })).toContainText("From the web");
    await expect(choices.getByText(/usually copyrighted/)).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);

    await stock.click();
    await expect(stock).toHaveAttribute("aria-pressed", "true");
    await choices.getByRole("button", { name: "Use this photo" }).click();
    await expect(page.getByRole("group", { name: "Photo choices" })).toHaveCount(0);
    await expect(page.locator(".photo-item")).toHaveCount(1);
    await expect(page.locator(".photo-item .photo-credit")).toHaveText("Photo: Jane Doe / Pixabay");

    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator(".recipe-cover img")).toBeVisible();
    await expect(page.locator(".recipe-cover .photo-credit")).toHaveText("Photo: Jane Doe / Pixabay");
  });

  test("review: find a photo for a new recipe that has none, added on approval", async ({ page, context, request }) => {
    await signInAsAdmin(context);
    const key = await createKey(page, `E1 ${test.info().project.name}`);
    const title = `Photoless Gazpacho ${test.info().project.name} ${Date.now()}`;
    const submitted = await request.post("/api/v1/recipes", {
      headers: { Authorization: `Bearer ${key}`, "Idempotency-Key": `e1-${Date.now()}` },
      data: { recipe: { title, ingredients: [{ quantity: "1", item: "tomato" }], steps: ["Simmer."] } },
    });
    expect(submitted.status()).toBe(202);

    await serveFoundImages(page);
    await page.goto("/review");
    // Match by heading: other cards may list this title as a possible duplicate.
    const card = page.locator(".review-card").filter({ has: page.getByRole("heading", { name: title }) });
    await card.getByRole("button", { name: "Find a photo" }).click();
    await card.getByRole("button", { name: /Stock photo: Photoless Gazpacho/ }).click();
    await card.getByRole("button", { name: "Use this photo" }).click();
    await expect(card.getByText("Added when you approve.")).toBeVisible();
    await expect(card.locator(".photo-credit")).toHaveText("Photo: Jane Doe / Pixabay");
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);

    await card.getByRole("button", { name: "Approve & apply" }).click();
    await expect(card).toHaveCount(0);
    await page.getByRole("link", { name: title }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator(".recipe-cover .photo-credit")).toHaveText("Photo: Jane Doe / Pixabay");
  });
});
