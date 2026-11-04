import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, fixtures, isPhone, signInAsAdmin, signInAsViewer } from "./fixtures";

/** Both elements sit on the same row of the top bar (their boxes overlap vertically). */
async function expectSameRow(a: Locator, b: Locator) {
  const [boxA, boxB] = [await a.boundingBox(), await b.boundingBox()];
  expect(boxA && boxB, "both elements should be visible").toBeTruthy();
  const overlap = Math.min(boxA!.y + boxA!.height, boxB!.y + boxB!.height) - Math.max(boxA!.y, boxB!.y);
  expect(overlap, "should be on the same row").toBeGreaterThan(0);
}

const brand = (page: Page) => page.getByRole("link", { name: "540 Kitchen" });
const header = (page: Page) => page.getByRole("banner");

test.describe("sign in from the top bar (E2)", () => {
  test("visitors see Sign in and a Settings gear beside the brand, and no footer", async ({ page }) => {
    await page.goto("/");
    const signIn = header(page).getByRole("link", { name: "Sign in", exact: true });
    const gear = header(page).getByRole("link", { name: "Settings" });
    await expect(signIn).toBeVisible();
    await expect(gear).toBeVisible();
    await expectSameRow(brand(page), signIn);
    await expectSameRow(brand(page), gear);
    await expect(page.getByText("Admin sign-in")).toHaveCount(0);
    await expect(page.locator("footer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dark" })).toHaveCount(0); // Appearance moved to Settings (E3)
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);
  });

  test("Sign in goes straight to Google and asks to come back to the same page", async ({ page }) => {
    const { recipeId } = fixtures();
    await page.route(/^https:\/\/accounts\.google\.com\//, (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Google</title><h1>Google sign-in</h1>" }),
    );
    await page.goto(`/recipes/${recipeId}`);
    const request = page.waitForRequest((r) => r.url().endsWith("/api/auth/sign-in/social") && r.method() === "POST");
    await header(page).getByRole("link", { name: "Sign in", exact: true }).click();
    expect((await request).postDataJSON()).toMatchObject({ provider: "google", callbackURL: `/recipes/${recipeId}` });
    await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//);
    await expect(page.getByRole("heading", { name: "Google sign-in" })).toBeVisible();
  });

  test("the sign-in page used by AI tool connections is still there, renamed", async ({ page }) => {
    await page.goto("/sign-in?next=%2Fsettings");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  });

  test("admins see their initial (no picture), then a menu with name, email, Settings and Sign out", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/");
    const account = header(page).getByRole("button", { name: "Account: Admin" });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute("aria-expanded", "false");
    await expect(account.locator(".avatar-initial")).toHaveText("A");
    await expectSameRow(brand(page), account);
    await expect(header(page).getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await account.click();
    await expect(account).toHaveAttribute("aria-expanded", "true");
    const menu = page.locator(".account-panel");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Admin");
    await expect(menu).toContainText("admin@example.com");
    await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(account).toBeFocused();

    await account.click();
    await menu.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(menu).toBeHidden(); // closes after navigating
  });

  test("a signed-in non-admin sees their Google picture and the browse-only note", async ({ page, context }) => {
    await signInAsViewer(context);
    await page.goto("/");
    const account = header(page).getByRole("button", { name: "Account: Pat Example" });
    const picture = account.locator("img.avatar");
    await expect(picture).toBeVisible();
    expect(await picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(header(page).getByRole("link", { name: "Add" })).toHaveCount(0);
    await account.click();
    await expect(page.locator(".account-panel")).toContainText("only cookbook admins can make changes");

    // Settings: Appearance only.
    await page.locator(".account-panel").getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "API keys" })).toHaveCount(0);
  });

  test("Sign out from the menu", async ({ page, context }) => {
    // Its own session, so other tests keep theirs.
    await signInAsViewer(context);
    await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' }));
    await page.goto("/settings");
    await header(page).getByRole("button", { name: /^Account:/ }).click();
    const done = page.waitForRequest("**/api/auth/sign-out");
    await page.locator(".account-panel").getByRole("button", { name: "Sign out" }).click();
    await done;
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("admin actions (E2 top bar, every screen size)", () => {
  test("logo and picture on one line, Add floats, Review and Import in the menu", async ({ page, context, request }) => {
    await signInAsAdmin(context);
    // A waiting submission, so the dot and the count show.
    await page.goto("/settings");
    await page.getByLabel("New key name").fill(`Dot ${test.info().project.name}`);
    await page.getByRole("button", { name: "Create key" }).click();
    const key = (await page.locator(".notice code").textContent())!.trim();
    const submitted = await request.post("/api/v1/recipes", {
      headers: { Authorization: `Bearer ${key}`, "Idempotency-Key": `dot-${test.info().project.name}-${Date.now()}` },
      data: { recipe: { title: `Waiting ${Date.now()}` } },
    });
    expect(submitted.status()).toBe(202);
    await page.goto("/");
    const account = header(page).getByRole("button", { name: /^Account: Admin/ });
    await expectSameRow(brand(page), account);
    const box = await header(page).boundingBox();
    expect(box!.height, "top bar: logo row plus search row at most").toBeLessThan(160);
    for (const name of ["Review", "Import", "Add"]) {
      await expect(header(page).getByRole("link", { name, exact: false }).filter({ visible: true })).toHaveCount(0);
    }

    await expect(account.locator(".account-dot")).toBeVisible();
    const fab = page.getByRole("link", { name: "Add a recipe" });
    await expect(fab).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    await account.click();
    const menu = page.locator(".account-panel");
    await expect(menu.getByRole("link", { name: /^Review, \d+ waiting$/ })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Import", exact: true })).toBeVisible();
    await expectAccessible(page);
    await menu.getByRole("link", { name: "Import", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Import a recipe" })).toBeVisible();
    await expect(fab).toHaveCount(0); // never covers the editor

    await page.goto("/");
    await fab.click();
    await expect(page).toHaveURL(/\/recipes\/new$/);
    await expect(fab).toHaveCount(0);
  });

  test("wider screens show the name next to the picture; phones show the picture only", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/");
    const name = header(page).locator(".account-name");
    if (isPhone(page)) await expect(name).toBeHidden();
    else await expect(name).toHaveText("Admin");
  });
});

test.describe("Settings for everyone (E3, E4)", () => {
  test("visitors get Appearance only, and their choice is saved on the device", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await header(page).getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    for (const hidden of ["Admin tools", "Approval for AI tools", "Connected AI apps", "API keys"]) {
      await expect(page.getByRole("heading", { name: hidden })).toHaveCount(0);
    }
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(23, 26, 33)");
    await expectAccessible(page);
    expect((await page.context().cookies()).find((c) => c.name === "theme")?.value).toBe("dark");
  });

  test("admins get Appearance, Admin tools with Backup and Deleted recipes, and the admin sections", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/settings");
    for (const heading of ["Appearance", "Admin tools", "Approval for AI tools", "Connected AI apps", "API keys"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    await page.getByRole("link", { name: "Backup" }).click();
    await expect(page).toHaveURL(/\/backup$/);
    await page.goBack();
    await page.getByRole("link", { name: "Deleted recipes" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Deleted recipes" })).toBeVisible();
  });

  test("admin settings changes still refuse visitors (401)", async ({ request }) => {
    const res = await request.post("/settings", { form: { intent: "approval", required: "false" }, maxRedirects: 0 });
    expect(res.status()).toBe(401);
  });
});
