import { beforeEach, describe, expect, it } from "vitest";
import { createRouterContext } from "../../app/context";
import { loader as backupDataLoader } from "../../app/routes/api.backup";
import { action as backupPhotoAction } from "../../app/routes/api.backup.photo";
import { action as restoreAction } from "../../app/routes/api.backup.restore";
import { action as photosAction } from "../../app/routes/api.photos";
import { loader as backupPageLoader } from "../../app/routes/backup";
import { action as recipeAction, loader as recipeLoader } from "../../app/routes/recipe";
import { loader as historyLoader } from "../../app/routes/recipe-history";
import { action as versionAction, loader as versionLoader } from "../../app/routes/recipe-version";
import type { Services } from "../../server/app";
import { validateEntry } from "../../server/core/recipes";
import { jpegWithMetadata } from "../helpers/images";
import { MemoryMediaStore } from "../helpers/memory-media";
import { ADMIN_EMAIL, BASE_URL, createTestServices, sessionCookieFor } from "../helpers/services";

let services: Services;
let admin: string;

beforeEach(async () => {
  services = createTestServices({ media: new MemoryMediaStore() });
  admin = await sessionCookieFor(services, ADMIN_EMAIL);
});

const args = (request: Request, params: Record<string, string> = {}) =>
  ({ request, params, context: createRouterContext(services) }) as never;

const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${BASE_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(init.cookie ? { Cookie: init.cookie } : {}) } });

async function status(promise: Promise<unknown>) {
  try {
    const result = await promise;
    return result instanceof Response ? result.status : 200;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    const init = (thrown as { init?: { status?: number } }).init;
    if (init?.status) return init.status;
    throw thrown;
  }
}

async function createRecipe(title = "Noodles") {
  const valid = validateEntry({ kind: "recipe", title, ingredients: [], steps: [], tags: [], collectionIds: [] });
  if (!valid.ok) throw new Error();
  const created = await services.catalog.create(valid.value, { userId: "seed" });
  return created.ok ? created.id : "";
}

function photoForm() {
  const form = new FormData();
  form.append("full", new Blob([new Uint8Array(jpegWithMetadata())], { type: "image/jpeg" }), "a.jpg");
  form.append("thumb", new Blob([new Uint8Array(jpegWithMetadata())], { type: "image/jpeg" }), "t.jpg");
  return form;
}

describe("new admin endpoints reject unauthorized requests (AC-064)", () => {
  it("photo upload, backup export, restore steps and photo restore all need an admin", async () => {
    const someone = await sessionCookieFor(services, "someone@example.com");
    for (const cookie of [undefined, someone]) {
      const expected = cookie ? 403 : 401;
      expect(await status(photosAction(args(req("/api/photos", { method: "POST", body: photoForm(), cookie }))))).toBe(expected);
      expect(await status(backupDataLoader(args(req("/api/backup", { cookie }))))).toBe(expected);
      expect(
        await status(restoreAction(args(req("/api/backup/restore", { method: "POST", body: JSON.stringify({ step: "begin" }), cookie })))),
      ).toBe(expected);
      expect(await status(backupPhotoAction(args(req("/api/backup/photo?key=x", { method: "POST", body: "x", cookie }))))).toBe(expected);
    }
    const id = await createRecipe();
    const note = new FormData();
    note.append("note", "sneaky");
    expect(await status(recipeAction(args(req(`/recipes/${id}`, { method: "POST", body: note }), { id })))).toBe(401);
    const restore = new FormData();
    restore.append("expectedRevision", "1");
    expect(await status(versionAction(args(req(`/recipes/${id}/history/1`, { method: "POST", body: restore }), { id, revision: "1" })))).toBe(401);
    expect(await status(backupPageLoader(args(req("/backup"))))).toBe(302);
  });
});

describe("admin endpoints work", () => {
  it("uploads a photo and returns its id and size", async () => {
    const response = (await photosAction(args(req("/api/photos", { method: "POST", body: photoForm(), cookie: admin })))) as Response;
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ width: 32, height: 16 });
  });

  it("rejects a non-image upload with a clear message", async () => {
    const form = new FormData();
    form.append("full", new Blob(["<svg onload=alert(1)>"], { type: "image/jpeg" }), "x.jpg");
    form.append("thumb", new Blob(["x"], { type: "image/jpeg" }), "t.jpg");
    const response = (await photosAction(args(req("/api/photos", { method: "POST", body: form, cookie: admin })))) as Response;
    expect(response.status).toBe(415);
    expect(((await response.json()) as { message: string }).message).toMatch(/JPEG, PNG or WebP/);
  });

  it("adds experiment notes and restores versions through the pages", async () => {
    const id = await createRecipe("Original");
    const valid = validateEntry({ kind: "recipe", title: "Edited", ingredients: [], steps: [], tags: [], collectionIds: [] });
    if (!valid.ok) throw new Error();
    await services.catalog.update(id, 1, valid.value, { userId: "seed" });

    const note = new FormData();
    note.append("note", "Tried it with udon");
    expect(await recipeAction(args(req(`/recipes/${id}`, { method: "POST", body: note, cookie: admin }), { id }))).toMatchObject({ noteError: null });
    const page = await recipeLoader(args(req(`/recipes/${id}`), { id }));
    expect(page.notes.map((n) => n.body)).toEqual(["Tried it with udon"]);

    const history = await historyLoader(args(req(`/recipes/${id}/history`), { id }));
    expect(history.versions.map((v) => v.revision)).toEqual([2, 1]);
    const version = await versionLoader(args(req(`/recipes/${id}/history/1`), { id, revision: "1" }));
    expect(version.changesToCurrent).toEqual([{ field: "title", label: "Title", type: "text", before: "Original", after: "Edited" }]);

    const stale = new FormData();
    stale.append("expectedRevision", "1");
    expect(await versionAction(args(req(`/recipes/${id}/history/1`, { method: "POST", body: stale, cookie: admin }), { id, revision: "1" }))).toMatchObject({
      error: expect.stringMatching(/changed since/),
    });
    const fresh = new FormData();
    fresh.append("expectedRevision", "2");
    const restored = (await versionAction(args(req(`/recipes/${id}/history/1`, { method: "POST", body: fresh, cookie: admin }), { id, revision: "1" }))) as Response;
    expect(restored.headers.get("Location")).toBe(`/recipes/${id}?restored=1`);
    expect((await services.catalog.get(id))?.title).toBe("Original");
  });

  it("restore begin: allowed when empty or resuming the same backup, refused otherwise", async () => {
    const begin = (ids: Record<string, string[]>) =>
      restoreAction(
        args(
          req("/api/backup/restore", {
            method: "POST",
            cookie: admin,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ step: "begin", format: "cookbook-backup", version: 1, ids }),
          }),
        ),
      ) as Promise<Response>;
    expect((await begin({})).status).toBe(200);
    const id = await createRecipe("Already here");
    expect((await begin({ recipes: [] })).status).toBe(409);
    expect((await begin({ recipes: [id] })).status).toBe(200); // resuming a partial restore of this backup
    expect(await (await begin({ recipes: ["other"] })).json()).toMatchObject({ message: expect.stringMatching(/empty cookbook/) });
  });
});
