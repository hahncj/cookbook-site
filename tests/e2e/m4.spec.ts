import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, fixtures, signInAsAdmin } from "./fixtures";

async function createKey(page: Page, name: string) {
  await page.goto("/settings");
  await page.getByLabel("New key name").fill(name);
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.locator(".notice code").textContent())!.trim();
  expect(key).toMatch(/^ck_/);
  return key;
}

test.describe("AI submissions and review (AC-011–014, AC-024, AC-070)", () => {
  test("a tool submits through the HTTP API; the admin approves it in Review", async ({ page, context, request }) => {
    await signInAsAdmin(context);
    const key = await createKey(page, `E2E ${test.info().project.name}`);
    const title = `Tool Recipe ${Date.now()}`;

    // An independent HTTP client plays the AI tool (AC-024).
    const submitted = await request.post("/api/v1/recipes", {
      headers: { Authorization: `Bearer ${key}`, "Idempotency-Key": `e2e-${Date.now()}` },
      data: {
        recipe: { title, ingredients: [{ quantity: "1 cup", item: "rice" }, { quantity: "", item: "salt, to taste" }], steps: ["Cook."] },
        note: "From a chat",
      },
    });
    expect(submitted.status()).toBe(202);
    const { submissionId } = await submitted.json();

    // Not public while pending (AC-070).
    const anon = await page.context().browser()!.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(`/?q=${encodeURIComponent(title)}`);
    await expect(anonPage.getByText("Nothing matches.")).toBeVisible();
    await anonPage.goto("/review");
    await expect(anonPage).toHaveURL(/\/sign-in\?next=%2Freview/);
    await anon.close();

    await page.goto("/");
    await expect(page.getByRole("link", { name: /^Review, \d+ waiting$/ })).toBeVisible();
    await page.getByRole("link", { name: /^Review, \d+ waiting$/ }).click();
    const card = page.locator(".review-card").filter({ hasText: title });
    await expect(card).toContainText("New · from API key");
    await expect(card).toContainText("“From a chat”");
    await card.getByText("Show the full recipe").click();
    await expect(card.getByText("salt, to taste")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    await card.getByRole("button", { name: "Approve & apply" }).click();
    await expect(page.locator(".review-card").filter({ hasText: title })).toHaveCount(0);
    await expect(page.locator(".trash-list li").filter({ hasText: title })).toContainText("Applied");

    const status = await request.get(`/api/v1/submissions/${submissionId}`, { headers: { Authorization: `Bearer ${key}` } });
    expect(await status.json()).toMatchObject({ status: "applied", revision: 1 });
    await page.goto(`/?q=${encodeURIComponent(title)}`);
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await page.getByRole("link", { name: /Version 1 · View history/ }).click();
    await expect(page.getByText("Changed by an AI tool")).toBeVisible();
  });

  test("an update shows what would change; rejecting leaves the recipe alone (AC-013, AC-059)", async ({ page, context, request }) => {
    await signInAsAdmin(context);
    const key = await createKey(page, `E2E update ${test.info().project.name}`);
    const { recipeId } = fixtures();
    const current = await (await request.get(`/api/v1/recipes/${recipeId}`, { headers: { Authorization: `Bearer ${key}` } })).json();
    const response = await request.post(`/api/v1/recipes/${recipeId}/updates`, {
      headers: { Authorization: `Bearer ${key}`, "Idempotency-Key": `e2e-upd-${Date.now()}` },
      data: { expectedRevision: current.revision, changes: { title: `Renamed ${test.info().project.name}` }, note: "Better name?" },
    });
    expect(response.status()).toBe(202);

    await page.goto("/review");
    const card = page.locator(".review-card").filter({ hasText: `Renamed ${test.info().project.name}` });
    await expect(card).toContainText("Update · from API key");
    await expect(card.locator("del")).toContainText("Gochujang Butter Noodles");
    await expect(card.locator("ins")).toContainText(`Renamed ${test.info().project.name}`);
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(page.locator(".review-card").filter({ hasText: `Renamed ${test.info().project.name}` })).toHaveCount(0);
    await page.goto(`/recipes/${recipeId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Gochujang Butter Noodles" })).toBeVisible();
  });
});

test.describe("settings (AC-014, revocation)", () => {
  test("approval switch, API key revoke, layout and accessibility", async ({ page, context, request }) => {
    test.skip(test.info().project.name !== "desktop", "Changes a shared setting; run once.");
    await signInAsAdmin(context);
    const key = await createKey(page, "E2E revoke");
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    await page.getByRole("button", { name: "Turn approval off" }).click();
    await expect(page.getByRole("button", { name: "Turn approval on" })).toBeVisible();
    const immediate = await request.post("/api/v1/recipes", {
      headers: { Authorization: `Bearer ${key}`, "Idempotency-Key": `e2e-now-${Date.now()}` },
      data: { recipe: { title: `Saved Immediately ${Date.now()}` } },
    });
    expect(immediate.status()).toBe(201);
    await page.getByRole("button", { name: "Turn approval on" }).click();
    await expect(page.getByRole("button", { name: "Turn approval off" })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(".trash-list li").filter({ hasText: "E2E revoke" }).getByRole("button", { name: "Revoke" }).click();
    await expect(page.locator(".trash-list li").filter({ hasText: "E2E revoke" })).toHaveCount(0);
    const refused = await request.get("/api/v1/recipes", { headers: { Authorization: `Bearer ${key}` } });
    expect(refused.status()).toBe(401);
  });
});
