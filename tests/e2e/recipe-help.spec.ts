import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, fixtures, signInAsAdmin, signInAsViewer } from "./fixtures";

// "AI help" on a recipe (D20): swaps for a missing ingredient and changing the
// recipe. The real Claude adapter runs against the local mock. Nothing here
// saves the seed recipe, so other specs see it unchanged.

test.describe("AI help on a recipe (D20)", () => {
  test("suggests swaps that can be kept as a note, and changes that open the editor", async ({ page, context }) => {
    const { recipeId } = fixtures();
    await signInAsAdmin(context);
    await page.goto(`/recipes/${recipeId}`);
    const help = page.getByRole("region", { name: "AI help" });

    // Missing an ingredient.
    await help.getByLabel("Ingredient you're missing").selectOption("unsalted butter");
    await help.getByLabel("What do you have?").fill("olive oil");
    await help.getByRole("button", { name: "Suggest swaps" }).click();
    await expect(help.getByText("A little tangier than unsalted butter.")).toBeVisible();
    await expect(help.getByText("AI suggestions for unsalted butter. Amounts are a starting point.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);
    await help.getByRole("button", { name: "Save as a note: plain Greek yogurt" }).click();
    await expect(help.getByText("Saved to Notes & experiments.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Notes & experiments" }).getByText(/AI swap idea for unsalted butter: plain Greek yogurt/).first()).toBeVisible();

    // Change this recipe → a new recipe in the import editor.
    await help.getByRole("button", { name: "Change this recipe" }).click();
    await help.getByLabel("How should it change?").fill("vegetarian");
    await help.getByRole("button", { name: "Suggest changes" }).click();
    await expect(help.getByText("Changed by AI · untested")).toBeVisible();
    await expect(help.getByText("Swapped 6 oz dried wheat noodles for 1 can of lentils")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await help.getByRole("button", { name: "Save as a new recipe…" }).click();
    await expect(page.getByLabel("Title")).toHaveValue("Gochujang Butter Noodles (vegetarian)");
    await expect(page.getByText("Written by AI and untested. Check the amounts, times and steps.")).toBeVisible();

    // Change this recipe → edit the same recipe (a new version on Save).
    await page.goto(`/recipes/${recipeId}`);
    await help.getByRole("button", { name: "Change this recipe" }).click();
    await help.getByLabel("How should it change?").fill("vegetarian");
    await help.getByRole("button", { name: "Suggest changes" }).click();
    await help.getByRole("button", { name: "Edit this recipe with these changes…" }).click();
    await expect(page).toHaveURL(new RegExp(`/recipes/${recipeId}/edit$`));
    await expect(page.getByText("Changed by AI. Check everything before saving.")).toBeVisible();
    await expect(page.getByText("Swapped 6 oz dried wheat noodles for 1 can of lentils")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Gochujang Butter Noodles (vegetarian)");
    await expect(page.getByLabel("Amount 1", { exact: true })).toHaveValue("1 can");
    await expectNoHorizontalScroll(page);
    // Leaving without saving keeps the recipe as it was.
    await page.goto(`/recipes/${recipeId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Gochujang Butter Noodles" })).toBeVisible();
  });

  test("visitors and non-admins don't get AI help", async ({ page, context }) => {
    const { recipeId } = fixtures();
    await page.goto(`/recipes/${recipeId}`);
    await expect(page.getByRole("region", { name: "AI help" })).toHaveCount(0);
    await signInAsViewer(context);
    await page.goto(`/recipes/${recipeId}`);
    await expect(page.getByRole("region", { name: "AI help" })).toHaveCount(0);
  });
});
