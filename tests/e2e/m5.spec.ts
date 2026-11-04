import { expect, test } from "@playwright/test";
import { E2E } from "../../playwright.config";
import { expectAccessible, expectNoHorizontalScroll, fixtures, jpegWithGps, signInAsAdmin } from "./fixtures";

test.describe("In-app AI (M5)", () => {
  test("paste import: review, save, and find it later (AC-049)", async ({ page, context }) => {
    await signInAsAdmin(context);
    const title = `Pasted Biscuits ${test.info().project.name} ${Date.now()}`;
    await page.goto("/");
    await page.getByRole("link", { name: "Import", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Import a recipe" })).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);

    await page.getByLabel("Recipe text").fill(`Sure! Here's the recipe.\nTitle: ${title}\n2 cups flour\nSECOND RECIPE follows...`);
    await page.getByRole("button", { name: "Read recipe" }).click();

    await expect(page.getByRole("heading", { name: "Review the import" })).toBeVisible();
    await expect(page.getByText("Extracted by AI. Missing details were left blank")).toBeVisible();
    await expect(page.getByText("Oven temperature wasn't given")).toBeVisible();
    await expect(page.getByText(/1 more recipe/)).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue(title);
    await expect(page.getByLabel("Amount 1")).toHaveValue("2 cups");
    await expect(page.getByLabel("Amount 2")).toHaveValue("");
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await page.goto(`/?q=${encodeURIComponent("Pasted Biscuits")}`);
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  });

  test("a failed import explains itself and keeps the text (AC-033, AC-048)", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/recipes/import");
    await page.getByLabel("Recipe text").fill("NO RECIPE HERE, just a chat about the weather.");
    await page.getByRole("button", { name: "Read recipe" }).click();
    await expect(page.getByRole("alert")).toContainText("No recipe was found");
    await expect(page.getByLabel("Recipe text")).toHaveValue("NO RECIPE HERE, just a chat about the weather.");
  });

  test("photo import reads a recipe card (AC-008)", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/recipes/import");
    await page.getByRole("button", { name: "Photo" }).click();
    await page.getByLabel("Photo or screenshot of a recipe").setInputFiles({ name: "card.jpg", mimeType: "image/jpeg", buffer: await jpegWithGps(page) });
    await page.getByRole("button", { name: "Read photo" }).click();
    await expect(page.getByLabel("Title")).toHaveValue("Photo Card Cookies");
  });

  test("ingredient identification adds editable names with blank amounts (AC-007, AC-045–047)", async ({ page, context }) => {
    await signInAsAdmin(context);
    const { recipeId } = fixtures();
    await page.goto(`/recipes/${recipeId}/edit`);
    const before = await page.locator('input[name="ingredientItem"]').evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value));
    await page.getByLabel("Title").fill("Typed but not saved");

    await page.getByRole("button", { name: "Identify ingredients with AI" }).click();
    await page.getByLabel("Description", { exact: false }).last().fill("Noodles with green onions and seeds on top");
    await page.getByRole("button", { name: "Identify", exact: true }).click();
    await expect(page.getByText("Not sure: Could be breadcrumbs")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Add sesame seeds" })).not.toBeChecked();
    await expectAccessible(page);

    await page.getByLabel("Suggestion 1 name").fill("scallions");
    await page.getByRole("button", { name: "Add chosen to ingredients" }).click();
    await expect(page.getByText(/Added 1 ingredient/)).toBeVisible();

    const after = await page.locator('input[name="ingredientItem"]').evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value));
    expect(after.filter(Boolean)).toEqual([...before.filter(Boolean), "scallions"]);
    const rows = page.locator(".ingredient-row");
    await expect(rows.last().locator('input[name="ingredientQuantity"]')).toHaveValue("");
    // Nothing else in the form changed, and nothing was saved.
    await expect(page.getByLabel("Title")).toHaveValue("Typed but not saved");
    await page.goto(`/recipes/${recipeId}`);
    await expect(page.getByText("scallions")).toHaveCount(0);
  });

  test("a new recipe with a familiar title shows a duplicate notice and an AI check (AC-057)", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto(`/recipes/${fixtures().recipeId}`);
    const existing = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
    await page.goto("/recipes/new");
    await page.getByLabel("Title").fill(existing);
    await page.getByLabel("Title").blur();
    const notice = page.locator(".duplicate-notice");
    await expect(notice).toContainText("may already be in the cookbook");
    await expect(notice.getByRole("link", { name: existing }).first()).toBeVisible();
    await notice.getByRole("button", { name: "Check with AI" }).first().click();
    await expect(notice).toContainText("A variation of the same dish");
    await expectAccessible(page);
  });

  test("without an API key, AI is shown as not set up (AC-036)", async ({ page, context }) => {
    await signInAsAdmin(context, "fresh");
    await page.goto(`${E2E.fresh.baseURL}/recipes/import`);
    await expect(page.getByText("AI features aren't set up yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Read recipe" })).toBeDisabled();
    await page.goto(`${E2E.fresh.baseURL}/recipes/new`);
    await expect(page.getByRole("button", { name: "Identify ingredients with AI" })).toHaveCount(0);
  });
});
