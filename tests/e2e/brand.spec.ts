import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll } from "./fixtures";

test("540 Kitchen logo, name, icons and Home Screen manifest", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("540 Kitchen");
  const logo = page.getByRole("link", { name: "540 Kitchen" }).getByRole("img", { name: "540 Kitchen" });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);

  for (const href of ["/brand/logo-32.png", "/brand/logo-192.png", "/brand/apple-touch-icon.png", "/brand/logo-512.png"]) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
  const manifest = await (await request.get("/site.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "540 Kitchen", short_name: "540 Kitchen", display: "standalone" });
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/brand/apple-touch-icon.png");
});
