import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, fixtures, signInAsAdmin, signInAsViewer } from "./fixtures";

// M6 — Cooking: serving adjustment (AC-054, AC-060), cooking mode with Screen
// Wake Lock (AC-055) and feedback markers (AC-056). Runs on phone (Chromium
// and WebKit), tablet and desktop.

/** Replaces the browser's Wake Lock API so each case is predictable in headless browsers. */
async function stubWakeLock(page: Page, mode: "supported" | "unsupported" | "denied") {
  await page.addInitScript((mode) => {
    const log = { requests: 0, releases: 0 };
    (window as unknown as { __wake: typeof log }).__wake = log;
    let value: unknown = undefined;
    if (mode !== "unsupported") {
      value = {
        request: async () => {
          log.requests++;
          if (mode === "denied") throw new DOMException("Not allowed", "NotAllowedError");
          const listeners: (() => void)[] = [];
          const sentinel = {
            released: false,
            type: "screen",
            addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
            release: async () => {
              if (sentinel.released) return;
              sentinel.released = true;
              log.releases++;
              listeners.forEach((listener) => listener());
            },
          };
          return sentinel;
        },
      };
    }
    Object.defineProperty(Navigator.prototype, "wakeLock", { configurable: true, get: () => value });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, get: () => value });
  }, mode);
}

const wakeLog = (page: Page) => page.evaluate(() => (window as unknown as { __wake: { requests: number; releases: number } }).__wake);

async function newRecipe(page: Page, title: string, yieldText: string, rows: [string, string][]) {
  await page.goto("/recipes/new");
  await page.getByLabel("Title").fill(title);
  if (yieldText) await page.getByLabel("Serves / makes").fill(yieldText);
  for (const [index, [quantity, item]] of rows.entries()) {
    const amount = page.getByLabel(`Amount ${index + 1}`, { exact: true });
    if ((await amount.count()) === 0) await page.getByRole("button", { name: "Add ingredient" }).click();
    await amount.fill(quantity);
    await page.getByLabel(`Ingredient ${index + 1}`, { exact: true }).fill(item);
  }
  await page.getByLabel("Method").fill("Bake for 25 minutes at 180°C.");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

const ingredientRow = (page: Page, item: string) =>
  page.getByRole("region", { name: "Ingredients" }).getByRole("listitem").filter({ hasText: item });

test.describe("serving adjustment (AC-054, AC-060)", () => {
  test("changing servings scales amounts, flags unknown ones and never changes the saved recipe", async ({ page }) => {
    const { recipeId } = fixtures();
    await page.goto(`/recipes/${recipeId}`);
    const schemaBefore = await page.locator('script[type="application/ld+json"]').textContent();

    const servings = page.getByRole("group", { name: "Servings" });
    await expect(servings.getByText("Recipe: Serves 2")).toBeVisible();
    await expect(servings.locator("output")).toHaveText("2");
    await expect(ingredientRow(page, "dried wheat noodles")).toContainText("6 oz");
    await expect(page.getByText(/Not scaled|No amount given/)).toHaveCount(0);

    await servings.getByRole("button", { name: "More servings" }).click();
    await servings.getByRole("button", { name: "More servings" }).click();
    await expect(servings.locator("output")).toHaveText("4");
    await expect(page.getByText("Scaled ×2")).toBeVisible();
    await expect(ingredientRow(page, "dried wheat noodles")).toContainText("12 oz");
    await expect(ingredientRow(page, "unsalted butter")).toContainText("4 tbsp");
    await expect(ingredientRow(page, "gochujang")).toContainText("3 tbsp");
    // Unknown amount: left as is and flagged for the cook.
    await expect(ingredientRow(page, "toasted sesame seeds")).toContainText("No amount given — adjust by eye");
    // Cooking times and step amounts are not changed.
    await expect(page.getByText("Prep 10 min")).toBeVisible();
    await expect(page.getByText("reserve ½ cup water")).toBeVisible();
    await expect(page.getByText(/Cooking times, temperatures, pan sizes/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    // Halving to 1 serving.
    await servings.getByRole("button", { name: "Fewer servings" }).click();
    await servings.getByRole("button", { name: "Fewer servings" }).click();
    await servings.getByRole("button", { name: "Fewer servings" }).click();
    await expect(servings.locator("output")).toHaveText("1");
    await expect(servings.getByRole("button", { name: "Fewer servings" })).toBeDisabled();
    await expect(ingredientRow(page, "dried wheat noodles")).toContainText("3 oz");
    await expect(ingredientRow(page, "gochujang")).toContainText("¾ tbsp");

    await page.getByRole("button", { name: "Reset" }).click();
    await expect(ingredientRow(page, "dried wheat noodles")).toContainText("6 oz");

    // The stored recipe and its schema.org markup never changed.
    await servings.getByRole("button", { name: "More servings" }).click();
    await page.reload();
    await expect(page.getByRole("group", { name: "Servings" }).locator("output")).toHaveText("2");
    await expect(ingredientRow(page, "dried wheat noodles")).toContainText("6 oz");
    expect(await page.locator('script[type="application/ld+json"]').textContent()).toBe(schemaBefore);
  });

  test("missing yield: scale by a multiple; ranges and fractions scale, unclear amounts don't", async ({ page, context }) => {
    await signInAsAdmin(context);
    const title = `No Yield Scones ${Date.now()}`;
    await newRecipe(page, title, "", [
      ["1 1/2 cups", "flour"],
      ["2-3 tbsp", "milk"],
      ["1 cup plus 2 tbsp", "cream"],
      ["a pinch", "salt"],
    ]);

    const scale = page.getByRole("group", { name: "Scale" });
    await expect(scale.getByText("doesn't say how many it serves")).toBeVisible();
    await expect(page.getByRole("group", { name: "Servings" })).toHaveCount(0);
    await expect(scale.getByRole("button", { name: "×1", exact: true })).toHaveAttribute("aria-pressed", "true");

    await scale.getByRole("button", { name: "×2", exact: true }).click();
    await expect(ingredientRow(page, "flour")).toContainText("3 cups");
    await expect(ingredientRow(page, "milk")).toContainText("4-6 tbsp");
    await expect(ingredientRow(page, "cream")).toContainText("1 cup plus 2 tbsp");
    await expect(ingredientRow(page, "cream")).toContainText("Not scaled — check this amount yourself");
    await expect(ingredientRow(page, "salt")).toContainText("a pinch");
    await expect(ingredientRow(page, "salt")).toContainText("Not scaled — adjust by eye");
    await expect(page.getByText("Bake for 25 minutes at 180°C.")).toBeVisible();

    await scale.getByRole("button", { name: "×½", exact: true }).click();
    await expect(ingredientRow(page, "flour")).toContainText("3/4 cups");
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);
  });
});

test.describe("cooking mode (AC-055)", () => {
  test("keeps the screen on where supported and lets go when closed", async ({ page }) => {
    await stubWakeLock(page, "supported");
    await page.goto(`/recipes/${fixtures().recipeId}`);
    await page.getByRole("button", { name: "Start cooking mode" }).click();

    const dialog = page.getByRole("dialog", { name: "Gochujang Butter Noodles" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("The screen will stay on while cooking mode is open.")).toBeVisible();
    expect(await wakeLog(page)).toEqual({ requests: 1, releases: 0 });

    // Scaling and checklists work inside cooking mode.
    await dialog.getByRole("button", { name: "More servings" }).click();
    await expect(dialog.getByRole("listitem").filter({ hasText: "dried wheat noodles" })).toContainText("9 oz");
    const butter = dialog.getByRole("checkbox", { name: /unsalted butter/ });
    await butter.check();
    await expect(butter).toBeChecked();
    const step = dialog.getByRole("button", { name: /Step 1:/ });
    await step.click();
    await expect(step).toHaveAttribute("aria-pressed", "true");
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    // Signed out: no "Mark as made".
    await expect(dialog.getByRole("button", { name: "Mark as made today" })).toHaveCount(0);

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await wakeLog(page)).toEqual({ requests: 1, releases: 1 });
    // The page keeps the chosen servings while it stays open.
    await expect(ingredientRow(page, "dried wheat noodles")).toContainText("9 oz");

    // Escape closes it too.
    await page.getByRole("button", { name: "Start cooking mode" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await wakeLog(page)).toEqual({ requests: 2, releases: 2 });
  });

  test("explains when the browser can't keep the screen on", async ({ page }) => {
    await stubWakeLock(page, "unsupported");
    await page.goto(`/recipes/${fixtures().recipeId}`);
    await page.getByRole("button", { name: "Start cooking mode" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("This browser can't keep the screen on")).toBeVisible();
    await expect(dialog.getByText(/Auto-Lock/)).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /gochujang/ })).toBeVisible();
    await expectAccessible(page);
  });

  test("explains a refusal and offers to try again", async ({ page }) => {
    await stubWakeLock(page, "denied");
    await page.goto(`/recipes/${fixtures().recipeId}`);
    await page.getByRole("button", { name: "Start cooking mode" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("The screen couldn't be kept on.", { exact: false })).toBeVisible();
    await dialog.getByRole("button", { name: "Keep screen on" }).click();
    await expect.poll(async () => (await wakeLog(page)).requests).toBe(2);
  });

  test("an idea with no ingredients or steps has no cooking controls", async ({ page }) => {
    await page.goto(`/recipes/${fixtures().ideaId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start cooking mode" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: /Servings|Scale/ })).toHaveCount(0);
  });
});

test.describe("feedback markers (AC-056)", () => {
  test("admin marks favorite, made and want to try; they persist and are public", async ({ page, context }) => {
    await signInAsAdmin(context);
    const title = `Marker Pie ${Date.now()}`;
    await newRecipe(page, title, "Serves 4", [["2 cups", "apples"]]);

    const feedback = page.getByRole("group", { name: "Feedback" });
    const favorite = feedback.getByRole("button", { name: "Favorite" });
    const want = feedback.getByRole("button", { name: "Want to try" });
    await expect(favorite).toHaveAttribute("aria-pressed", "false");

    await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
    await want.click();
    await expect(want).toHaveAttribute("aria-pressed", "true");
    await expectAccessible(page);

    // Made: records a dated "made", clears "want to try", leaves favorite alone.
    await feedback.getByRole("button", { name: "Made it" }).click();
    await expect(feedback.getByRole("button", { name: "Made", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(want).toHaveAttribute("aria-pressed", "false");
    await expect(favorite).toHaveAttribute("aria-pressed", "true");

    // Made again, then undo.
    await feedback.getByRole("button", { name: "Made", exact: true }).click();
    await page.getByRole("button", { name: "Made it again today" }).click();
    await expect(feedback.getByRole("button", { name: "Made 2×" })).toBeVisible();
    await page.getByRole("button", { name: "Undo last “made”" }).click();
    await expect(feedback.getByRole("button", { name: "Made", exact: true })).toBeVisible();

    // Persisted.
    await page.reload();
    await expect(page.getByRole("group", { name: "Feedback" }).getByRole("button", { name: "Favorite" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "Feedback" }).getByRole("button", { name: "Made", exact: true })).toHaveAttribute("aria-pressed", "true");

    // Cooking mode: "Mark as made today".
    await page.getByRole("button", { name: "Start cooking mode" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark as made today" }).click();
    await expect(page.getByRole("dialog").getByText("Marked as made today (2 times so far).")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("group", { name: "Feedback" }).getByRole("button", { name: "Made 2×" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Public: a signed-out visitor sees the markers but can't change them.
    const url = page.url();
    const anon = await page.context().browser()!.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(url);
    const badges = anonPage.getByRole("list", { name: "Feedback" });
    await expect(badges.getByText("Favorite")).toBeVisible();
    await expect(badges.getByText(/Made 2×/)).toBeVisible();
    await expect(badges.getByText("Want to try")).toHaveCount(0);
    await expect(anonPage.getByRole("button", { name: "Favorite" })).toHaveCount(0);
    await expectAccessible(anonPage);
    await anon.close();
  });

  test("a signed-in non-admin sees markers without buttons", async ({ page, context }) => {
    await signInAsViewer(context);
    await page.goto(`/recipes/${fixtures().recipeId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("group", { name: "Feedback" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Favorite" })).toHaveCount(0);
  });
});
