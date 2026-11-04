import { expect, test, type Page } from "@playwright/test";
import { E2E } from "../../playwright.config";
import { expectAccessible, expectNoHorizontalScroll, jpegWithGps, signInAsAdmin } from "./fixtures";

async function newRecipe(page: Page, title: string, options: { photo?: Buffer; caption?: string } = {}) {
  await page.goto("/recipes/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Amount 1", { exact: true }).fill("2 tsp");
  await page.getByLabel("Ingredient 1", { exact: true }).fill("honey");
  await page.getByLabel("Method").fill("Mix.\nBake.");
  if (options.photo) {
    await page.getByLabel("Upload photos").setInputFiles({ name: "dish.jpg", mimeType: "image/jpeg", buffer: options.photo });
    await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();
    if (options.caption) await page.getByLabel("Caption for photo 1").fill(options.caption);
  }
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return page.url().split("/").pop()!;
}

test.describe("photos (AC-006, AC-043, AC-044)", () => {
  test("upload a photo: shown with the recipe and in the catalog, stored without location data", async ({ page, context, request }) => {
    await signInAsAdmin(context);
    await page.goto("/");
    const title = `Photo Test ${Date.now()}`;
    await newRecipe(page, title, { photo: await jpegWithGps(page), caption: "Finished dish" });

    const cover = page.getByRole("img", { name: "Finished dish" });
    await expect(cover).toBeVisible();
    expect(await cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByText("Finished dish", { exact: true })).toBeVisible(); // caption
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    const src = await cover.getAttribute("src");
    const stored = await (await request.get(src!)).body();
    expect(stored.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(stored.toString("latin1")).not.toContain("GPS");
    expect(stored.toString("latin1")).not.toContain("Exif");

    // A signed-out visitor sees the photo too.
    const anon = await page.context().browser()!.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(page.url());
    await expect(anonPage.getByRole("img", { name: "Finished dish" })).toBeVisible();
    await anonPage.goto(`/?q=${encodeURIComponent(title)}`);
    expect(await anonPage.locator("img.thumb").first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await anon.close();
  });

  test("the editor offers the phone camera and a regular upload", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/recipes/new");
    await expect(page.locator('input[type="file"][capture="environment"]')).toHaveCount(1); // Take photo
    await expect(page.locator('input[type="file"][multiple]:not([capture])')).toHaveCount(1); // Upload, also the fallback without a camera
    await expect(page.getByText("Adding a photo doesn't run any AI.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);
  });

  test("a non-image file gets a clear message and the form keeps its content (AC-048)", async ({ page, context }) => {
    await signInAsAdmin(context);
    await page.goto("/recipes/new");
    await page.getByLabel("Title").fill("Keep me");
    await page.getByLabel("Upload photos").setInputFiles({ name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not really an image") });
    await expect(page.getByRole("alert")).toContainText(/can't read that photo/);
    await expect(page.getByLabel("Title")).toHaveValue("Keep me");
  });
});

test.describe("history and notes (AC-050, AC-051, AC-052, AC-058)", () => {
  test("edit with a note, compare versions, restore an earlier one", async ({ page, context }) => {
    await signInAsAdmin(context);
    const title = `History Test ${Date.now()}`;
    const id = await newRecipe(page, title);

    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Title").fill(`${title} (sweeter)`);
    await page.getByLabel("Amount 1", { exact: true }).fill("2 tbsp");
    await page.getByLabel(/What changed/).fill("More honey");
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: `${title} (sweeter)` })).toBeVisible();

    await page.getByRole("link", { name: /Version 2 · View history/ }).click();
    await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
    await expect(page.getByText("“More honey”")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    await page.getByRole("link", { name: /Version 1/ }).click();
    await expect(page.getByRole("heading", { name: "Differences from the current version" })).toBeVisible();
    // From version 1 to the current version: the amount changed.
    await expect(page.locator("del").filter({ hasText: "2 tsp honey" })).toBeVisible();
    await expect(page.locator("ins").filter({ hasText: "2 tbsp honey" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);

    await page.getByRole("button", { name: "Restore this version" }).click();
    await expect(page).toHaveURL(new RegExp(`/recipes/${id}\\?restored=1$`));
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("2 tsp")).toBeVisible();
    await page.getByRole("link", { name: /Version 3 · View history/ }).click();
    await expect(page.getByText("Restored version 1")).toBeVisible();
    await expect(page.getByRole("link", { name: /Version 2/ })).toBeVisible(); // in-between version kept
  });

  test("add a dated experiment note", async ({ page, context }) => {
    await signInAsAdmin(context);
    await newRecipe(page, `Notes Test ${Date.now()}`);
    await page.getByLabel("Add a note about an experiment or change").fill("Tried it with brown butter — great.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.locator(".experiment-list")).toContainText("Tried it with brown butter — great.");
    await expect(page.getByRole("link", { name: /Version 1 · View history/ })).toBeVisible(); // no new version
  });
});

test.describe("backup and restore into a fresh instance (AC-041, AC-053, AC-061)", () => {
  test("download a full backup and restore it into an empty cookbook", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The empty instance can only be restored into once.");
    test.setTimeout(120_000);
    await signInAsAdmin(context);
    const title = `Backup Test ${Date.now()}`;
    await newRecipe(page, title, { photo: await jpegWithGps(page), caption: "Backed up" });
    await page.getByLabel("Add a note about an experiment or change").fill("Note that must survive");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.locator(".experiment-list")).toContainText("Note that must survive");
    const sourceUrlPath = new URL(page.url()).pathname;

    await page.goto("/backup");
    await expectAccessible(page);
    await expect(page.getByText(/Restore is only available on an empty cookbook/)).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download full backup" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^cookbook-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    const zipPath = testInfo.outputPath("backup.zip");
    await download.saveAs(zipPath);

    // Restore into the empty second instance.
    await signInAsAdmin(context, "fresh");
    await page.goto(`${E2E.fresh.baseURL}/`);
    await expect(page.getByRole("heading", { name: "A fresh notebook." })).toBeVisible();
    await page.goto(`${E2E.fresh.baseURL}/backup`);
    await page.getByLabel("Backup file (.zip)").setInputFiles(zipPath);
    await page.getByRole("button", { name: "Restore backup" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Restored \d+ entries/ })).toBeVisible({ timeout: 60_000 });

    // Same recipe, same id, photo, note and history.
    await page.goto(`${E2E.fresh.baseURL}${sourceUrlPath}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const cover = page.getByRole("img", { name: "Backed up" });
    await expect(cover).toBeVisible();
    expect(await cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator(".experiment-list")).toContainText("Note that must survive");
    await page.goto(`${E2E.fresh.baseURL}/?q=gochujang`);
    await expect(page.getByRole("link", { name: /Gochujang Butter Noodles/ })).toBeVisible(); // search index rebuilt
    await page.goto(`${E2E.fresh.baseURL}/backup`);
    await expect(page.getByText(/Restore is only available on an empty cookbook/)).toBeVisible(); // can't restore twice
  });
});
