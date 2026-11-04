import { expect, test, type Page } from "@playwright/test";
import { E2E } from "../../playwright.config";
import { clickAdminLink, expectAccessible, expectNoHorizontalScroll, signInAsAdmin, signInAsViewer } from "./fixtures";

// M7 — Recommendations and preferences: AC-015, AC-016, AC-017, AC-034,
// AC-035. The real Claude adapter runs against the local mock (no paid
// calls), including web search results, a fetched page and a paused turn.
// Runs on phone (Chromium and WebKit), tablet and desktop.

/**
 * Every project shares one database, so the profile test starts from an
 * empty profile: reject everything, then forget the rejections.
 */
async function resetProfile(page: Page) {
  for (const pass of ["reject", "forget"] as const) {
    await page.goto("/preferences");
    const items = page.locator("[data-pref-id]");
    for (const item of await items.all()) {
      const id = await item.getAttribute("data-pref-id");
      const status = await item.getAttribute("data-status");
      if ((pass === "reject") === (status === "rejected")) continue;
      const response = await page.request.post("/preferences", { form: { intent: pass, id: id! } });
      expect(response.ok()).toBe(true);
    }
  }
  await page.goto("/preferences");
  await expect(page.locator("[data-pref-id]")).toHaveCount(0);
}

const section = (page: Page, name: string) => page.getByRole("region", { name });

test.describe("preferences (AC-016, AC-017, AC-035)", () => {
  test("refresh infers preferences with evidence; corrections and rejections survive a refresh and shape suggestions", async ({ page, context }) => {
    await signInAsAdmin(context);
    await resetProfile(page);

    // AC-016: inferred from the cookbook, with the recipes behind each guess.
    await page.getByRole("button", { name: "Refresh from my recipes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "2 suggestions to review" })).toBeVisible();
    const suggested = section(page, "Suggested by AI");
    await expect(suggested.getByText("Likes spicy Korean flavors such as gochujang")).toBeVisible();
    await expect(suggested.getByText("Enjoys hearty one-pot meals")).toBeVisible();
    await expect(suggested.getByText(/Based on:/).first().getByRole("link")).not.toHaveCount(0);
    // Never a medical inference, never made-up evidence.
    await expect(page.getByText("Has a peanut allergy")).toHaveCount(0);
    await expect(page.getByText("Loves invented dishes")).toHaveCount(0);
    await expect(page.getByText("A small sample, so these are guesses.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    // AC-017: correct one, reject another.
    await page.getByRole("button", { name: "Correct: Likes spicy Korean flavors such as gochujang" }).click();
    await page.getByLabel("Corrected preference").fill("Likes mild Korean flavors, not too spicy");
    await page.getByRole("button", { name: "Save correction" }).click();
    const confirmed = section(page, "Confirmed");
    await expect(confirmed.getByText("Likes mild Korean flavors, not too spicy")).toBeVisible();
    await expect(confirmed.getByText(/AI first said: “Likes spicy Korean flavors such as gochujang”/)).toBeVisible();

    await page.getByRole("button", { name: "Not true: Enjoys hearty one-pot meals" }).click();
    await expect(section(page, "Not true").getByText("Enjoys hearty one-pot meals")).toBeVisible();

    // AC-035: the mock repeats both inferences, but neither comes back.
    await page.getByRole("button", { name: "Refresh from my recipes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "No new suggestions this time" })).toBeVisible();
    await expect(section(page, "Suggested by AI")).toHaveCount(0);
    await expect(section(page, "Not true").getByText("Enjoys hearty one-pot meals")).toBeVisible();
    await expect(confirmed.getByText("Likes mild Korean flavors, not too spicy")).toBeVisible();

    // AC-017: later recommendations reflect the correction.
    await page.goto("/ask");
    await page.getByLabel("Also look for new recipes on the web").uncheck();
    await page.getByLabel("What are you looking for?").fill("noodles tonight");
    await page.getByRole("button", { name: "Get suggestions" }).click();
    await expect(page.getByText("Matches your preference: Likes mild Korean flavors, not too spicy.").first()).toBeVisible();

    // Visitors can read the profile (D3) but get no controls.
    await context.clearCookies();
    await page.goto("/preferences");
    await expect(page.getByText("Likes mild Korean flavors, not too spicy")).toBeVisible();
    await expect(page.getByRole("button", { name: /Refresh|Not true|Correct|Allow again/ })).toHaveCount(0);
  });
});

test.describe("Ask AI (AC-015, AC-034)", () => {
  test("suggests labeled saved recipes and web discoveries with sources, and saving goes through the editor", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/");
    await clickAdminLink(page, "Ask AI");
    await expect(page.getByRole("heading", { level: 1, name: "Ask AI" })).toBeVisible();
    await expect(page.getByLabel("Also look for new recipes on the web")).toBeChecked();
    await page.getByLabel("What are you looking for?").fill("noodles tonight");
    await page.getByRole("button", { name: "Get suggestions" }).click();

    const results = page.getByRole("region", { name: "Suggestions" });
    const savedCard = results.getByRole("listitem").filter({ hasText: "Saved recipe" }).filter({ hasText: "Gochujang Butter Noodles" }).first();
    await expect(savedCard).toBeVisible();
    await expect(savedCard).toContainText("Fits “noodles tonight”.");
    // A made-up recipe id is never shown.
    await expect(results.getByText("Not a real recipe.")).toHaveCount(0);

    // AC-034: the web discovery is labeled, links to its source, and says the page was read.
    const webCard = results.getByRole("listitem").filter({ hasText: "Web discovery" });
    await expect(webCard).toHaveCount(1);
    const link = webCard.getByRole("link", { name: /Miso Glazed Eggplant/ });
    await expect(link).toHaveAttribute("href", "https://recipes.e2e.test/miso-eggplant");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(webCard).toContainText("Source: E2E Recipes (recipes.e2e.test)");
    await expect(webCard).toContainText("Page read by AI");
    // The invented link is dropped, and the page says so.
    await expect(results.getByText("Imaginary Pie")).toHaveCount(0);
    await expect(results.getByText("1 web suggestion was left out because the link couldn't be confirmed.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    // Saving is explicit: the import editor opens with the link; nothing is saved yet (D2).
    await webCard.getByRole("link", { name: "Save to cookbook…" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Import a recipe" })).toBeVisible();
    await expect(page.getByLabel("Web address")).toHaveValue("https://recipes.e2e.test/miso-eggplant");
    await expect(page.getByRole("button", { name: "Web link" })).toHaveAttribute("aria-pressed", "true");
  });

  test("only admins can ask; without an API key it says AI isn't set up", async ({ page, context }) => {
    const response = await page.goto("/ask");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fask/);
    expect(response?.ok()).toBe(true);

    await signInAsViewer(context);
    const denied = await page.goto("/ask");
    expect(denied?.status()).toBe(403);

    await context.clearCookies();
    await signInAsAdmin(context, "fresh");
    await page.goto(`${E2E.fresh.baseURL}/ask`);
    await expect(page.getByText("AI features aren't set up yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Get suggestions" })).toBeDisabled();
  });
});
