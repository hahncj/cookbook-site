import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, fixtures, signInAsAdmin } from "./fixtures";

test.describe("public visitors (AC-001, AC-027, AC-065)", () => {
  test("browse, search and read without signing in", async ({ page }) => {
    const { recipeId } = fixtures();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "All recipes" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Gochujang Butter Noodles/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admin sign-in" })).toBeVisible();

    await page.getByLabel("Search recipes").fill("udon");
    await page.getByLabel("Search recipes").press("Enter");
    await expect(page).toHaveURL(/\?q=udon/);
    await expect(page.getByRole("link", { name: /Gochujang Butter Noodles/ })).toBeVisible();
    await expect(page.getByText("1 entry")).toBeVisible();

    await page.goto(`/recipes/${recipeId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Gochujang Butter Noodles" })).toBeVisible();
    await expect(page.getByText("1½ tbsp")).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}");
    expect(ld).toMatchObject({ "@type": "Recipe", name: "Gochujang Butter Noodles", prepTime: "PT10M" });
  });

  test("filters by tag and kind", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Ideas" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Miso caramel/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Gochujang/ })).toHaveCount(0);
    await page.goto("/?tag=vegetarian");
    await expect(page.getByRole("link", { name: /Black Bean Chili/ })).toBeVisible();
  });
});

test.describe("layout and accessibility (AC-026, AC-037)", () => {
  test("public pages fit the screen and pass accessibility checks", async ({ page }) => {
    const { recipeId, longId, ideaId } = fixtures();
    for (const path of ["/", "/?q=noodles", `/recipes/${recipeId}`, `/recipes/${longId}`, `/recipes/${ideaId}`, "/sign-in", "/?q=nothing-matches"]) {
      await page.goto(path);
      await expectNoHorizontalScroll(page);
      await expectAccessible(page);
    }
  });

  test("admin pages fit the screen and pass accessibility checks", async ({ page, context }) => {
    const { recipeId } = fixtures();
    await signInAsAdmin(context);
    for (const path of ["/", "/recipes/new", `/recipes/${recipeId}/edit`, "/deleted"]) {
      await page.goto(path);
      await expectNoHorizontalScroll(page);
      await expectAccessible(page);
    }
  });

  test("the search box is reachable by keyboard", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab"); // skip link
    await page.keyboard.press("Tab"); // brand
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Search recipes")).toBeFocused();
  });
});

test.describe("themes (AC-071, AC-072)", () => {
  test("System follows the device setting", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(23, 26, 33)");
    await expectAccessible(page);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 244, 236)");
  });

  test("a chosen theme is remembered and rendered by the server (no flash)", async ({ page, request }) => {
    const { recipeId } = fixtures();
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/recipes/${recipeId}`);
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page).toHaveURL(new RegExp(`/recipes/${recipeId}$`));
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(23, 26, 33)");
    await expectAccessible(page);

    const cookies = await page.context().cookies();
    const theme = cookies.find((c) => c.name === "theme");
    expect(theme?.value).toBe("dark");
    // The raw HTML already carries the theme, before any script runs.
    const html = await (await request.get(`/recipes/${recipeId}`, { headers: { Cookie: "theme=dark" } })).text();
    expect(html).toMatch(/<html[^>]*data-theme="dark"/);
  });
});

test.describe("admin flow (AC-005, AC-009, AC-068, D6)", () => {
  test("add a recipe, find it, edit it, delete and restore it", async ({ page, context }) => {
    await signInAsAdmin(context);
    const title = `Smoky Chipotle Salsa ${Date.now()}`;
    await page.goto("/");
    await page.getByRole("link", { name: "Add" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Serves / makes").fill("Makes 2 cups");
    await page.getByLabel("Amount 1", { exact: true }).fill("4");
    await page.getByLabel("Ingredient 1", { exact: true }).fill("ripe tomatoes");
    await page.getByLabel("Ingredient 2", { exact: true }).fill("chipotle in adobo, to taste");
    await page.getByLabel("Method").fill("Char the tomatoes.\nBlend everything.");
    await page.getByLabel(/^Tags/).fill("Sauces");
    await page.getByRole("checkbox", { name: "Weeknight rotation" }).check();
    await page.getByRole("button", { name: "Save" }).first().click();

    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("chipotle in adobo, to taste")).toBeVisible();

    // Immediately public (AC-068): a signed-out browser sees it.
    const publicPage = await page.context().browser()!.newPage();
    await publicPage.goto(page.url());
    await expect(publicPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await publicPage.close();

    await page.goto("/?q=chipotle");
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();

    await page.getByRole("link", { name: new RegExp(title) }).click();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Title").fill(`${title} (v2)`);
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: `${title} (v2)` })).toBeVisible();

    await page.getByRole("link", { name: "Edit" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete recipe" }).click();
    await expect(page.getByRole("heading", { name: "Deleted recipes" })).toBeVisible();
    await expect(page.getByText(`${title} (v2)`)).toBeVisible();

    await page.goto("/?q=chipotle");
    await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);

    await page.goto("/deleted");
    await page.getByRole("listitem").filter({ hasText: `${title} (v2)` }).getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `${title} (v2)` })).toBeVisible();
  });

  test("validation errors keep what was typed (AC-048)", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/recipes/new");
    await page.getByLabel("Amount 1", { exact: true }).fill("2 cups");
    await page.getByLabel("Ingredient 1", { exact: true }).fill("flour");
    await page.getByLabel("Source link").fill("not a link");
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByRole("alert").first()).toContainText("Not saved yet");
    await expect(page.getByText("Give it a title")).toBeVisible();
    await expect(page.getByLabel("Amount 1", { exact: true })).toHaveValue("2 cups");
    await expect(page.getByLabel("Ingredient 1", { exact: true })).toHaveValue("flour");
    await expectNoHorizontalScroll(page);
  });
});
