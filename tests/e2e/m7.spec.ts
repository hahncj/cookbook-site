import { expect, test, type Page } from "@playwright/test";
import { E2E } from "../../playwright.config";
import { expectAccessible, expectNoHorizontalScroll, signInAsAdmin, signInAsViewer } from "./fixtures";

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

const modeButton = (page: Page, mode: "AI" | "Web") =>
  page.getByRole("banner").getByRole("button", { name: mode === "AI" ? "AI: write new recipes" : "Web: find new recipes" });

/** Picks AI or Web in the header search bar and asks for new recipes. */
async function findWithAi(page: Page, request: string, mode: "AI" | "Web" = "AI") {
  if ((await modeButton(page, mode).getAttribute("aria-pressed")) !== "true") await modeButton(page, mode).click();
  await expect(modeButton(page, mode)).toHaveAttribute("aria-pressed", "true");
  const box = page.getByRole("searchbox", { name: mode === "AI" ? "Describe new recipes for AI to write" : "Describe new recipes to find on the web" });
  await box.fill(request);
  await box.press("Enter");
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole("heading", { level: 2, name: `New recipes for “${request}”` })).toBeVisible();
}

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

    // AC-017: later AI searches reflect the correction.
    await findWithAi(page, "noodles tonight");
    await expect(page.getByText("Matches your preference: Likes mild Korean flavors, not too spicy.")).toBeVisible();

    // Visitors can read the profile (D3) but get no controls.
    await context.clearCookies();
    await page.goto("/preferences");
    await expect(page.getByText("Likes mild Korean flavors, not too spicy")).toBeVisible();
    await expect(page.getByRole("button", { name: /Refresh|Not true|Correct|Allow again/ })).toHaveCount(0);
  });
});

test.describe("AI mode in the search bar (AC-015, AC-034)", () => {
  test("AI: labeled AI-written recipes that save through the editor; preferences can be left out", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/");
    await expect(modeButton(page, "AI")).toHaveAttribute("aria-pressed", "false");
    await expect(modeButton(page, "Web")).toHaveAttribute("aria-pressed", "false");
    await findWithAi(page, "noodles tonight, ignore my preferences");

    const results = page.getByRole("region", { name: /New recipes for/ });
    await expect(results.getByText("Written by AI · preferences not used")).toBeVisible();
    await expect(results.getByRole("listitem").filter({ hasText: "From the web" })).toHaveCount(0);
    // D19: AI-written recipes are labeled untested, with the full recipe on request.
    const written = results.getByRole("listitem").filter({ hasText: "Written by AI · untested" });
    await expect(written).toHaveCount(1);
    await expect(written.getByRole("heading", { name: "AI Noodles Tonight, Ignore My Preferences Bowl" })).toBeVisible();
    await expect(written).not.toContainText("Matches your preference");
    await written.getByText("Show ingredients and steps").click();
    await expect(written.getByText("200 g rice noodles")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    // Saving is explicit: the editor opens with the recipe; nothing is saved until Save (D2).
    await written.getByRole("button", { name: "Save to cookbook: AI Noodles Tonight, Ignore My Preferences Bowl" }).click();
    await expect(page.getByText("Written by AI and untested. Check the amounts, times and steps.")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("AI Noodles Tonight, Ignore My Preferences Bowl");
    await expect(page.getByLabel("Amount 1", { exact: true })).toHaveValue("200 g");
    await expect(modeButton(page, "AI")).toHaveAttribute("aria-pressed", "false");

    // With neither selected, the same box searches the cookbook as before.
    const search = page.getByRole("searchbox", { name: "Search recipes" });
    await search.fill("gochujang");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/\?q=gochujang/);
  });

  test("Web: labeled web recipes with verified sources", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/");
    await findWithAi(page, "noodles tonight", "Web");

    const results = page.getByRole("region", { name: /New recipes for/ });
    await expect(results.getByText(/Found on the web · your preferences were used/)).toBeVisible();
    await expect(results.getByRole("listitem").filter({ hasText: "Written by AI" })).toHaveCount(0);
    // AC-034: web recipes are labeled, link to their source, and say the page was read.
    const webCard = results.getByRole("listitem").filter({ hasText: "From the web" });
    await expect(webCard).toHaveCount(1);
    const link = webCard.getByRole("link", { name: /Miso Glazed Eggplant/ });
    await expect(link).toHaveAttribute("href", "https://recipes.e2e.test/miso-eggplant");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(webCard).toContainText("Source: E2E Recipes (recipes.e2e.test)");
    await expect(webCard).toContainText("Page read by AI");
    await expect(webCard.getByRole("link", { name: "Save to cookbook…" })).toHaveAttribute(
      "href",
      "/recipes/import?url=https%3A%2F%2Frecipes.e2e.test%2Fmiso-eggplant",
    );
    // The invented link is dropped, and the page says so.
    await expect(results.getByText("Imaginary Pie")).toHaveCount(0);
    await expect(results.getByText("1 web suggestion was left out because the link couldn't be confirmed.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    // The results page keeps Web selected; tapping it again goes back to normal search.
    await expect(modeButton(page, "Web")).toHaveAttribute("aria-pressed", "true");
    await modeButton(page, "Web").click();
    await expect(page.getByRole("searchbox", { name: "Search recipes" })).toBeVisible();
  });

  test("only admins get AI mode; without an API key it says AI isn't set up", async ({ page, context }) => {
    await page.goto("/");
    await expect(modeButton(page, "AI")).toHaveCount(0);
    await page.goto("/discover");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdiscover/);

    await signInAsViewer(context);
    await page.goto("/");
    await expect(modeButton(page, "Web")).toHaveCount(0);
    const denied = await page.goto("/discover");
    expect(denied?.status()).toBe(403);

    await context.clearCookies();
    await signInAsAdmin(context, "fresh");
    await page.goto(`${E2E.fresh.baseURL}/discover`);
    await expect(page.getByText("AI features aren't set up yet")).toBeVisible();
  });
});
