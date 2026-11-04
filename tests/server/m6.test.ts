import { beforeEach, describe, expect, it } from "vitest";
import { createRouterContext } from "../../app/context";
import { action as recipeAction, loader as recipeLoader } from "../../app/routes/recipe";
import type { Services } from "../../server/app";
import { exportBackupData, importRows, TABLE_ORDER } from "../../server/backup";
import { validateEntry, type EntryInput } from "../../server/core/recipes";
import { ADMIN_EMAIL, BASE_URL, createTestServices, sessionCookieFor } from "../helpers/services";

let services: Services;
let admin: string;
const actor = { userId: "seed" };

beforeEach(async () => {
  services = createTestServices();
  admin = await sessionCookieFor(services, ADMIN_EMAIL);
});

const args = (request: Request, params: Record<string, string> = {}) =>
  ({ request, params, context: createRouterContext(services) }) as never;

const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${BASE_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(init.cookie ? { Cookie: init.cookie } : {}) } });

async function status(promise: Promise<unknown>) {
  try {
    const result = await promise;
    if (result instanceof Response) return result.status;
    const init = (result as { init?: { status?: number } } | null)?.init;
    return init?.status ?? 200;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    const init = (thrown as { init?: { status?: number } }).init;
    if (init?.status) return init.status;
    throw thrown;
  }
}

function input(overrides: Partial<EntryInput> = {}): EntryInput {
  const valid = validateEntry({
    kind: "recipe",
    title: "Gochujang noodles",
    yieldText: "Serves 2",
    ingredients: [
      { quantity: "6 oz", item: "noodles" },
      { quantity: "", item: "sesame seeds, to taste" },
    ],
    steps: ["Boil for 8 minutes."],
    tags: [],
    collectionIds: [],
    ...overrides,
  });
  if (!valid.ok) throw new Error("invalid");
  return valid.value;
}

async function create(overrides: Partial<EntryInput> = {}) {
  const created = await services.catalog.create(input(overrides), actor);
  if (!created.ok) throw new Error();
  return created.id;
}

const markerForm = (marker: string) => {
  const form = new FormData();
  form.append("marker", marker);
  return form;
};

const mark = (id: string, marker: string, cookie: string | undefined = admin) =>
  recipeAction(args(req(`/recipes/${id}`, { method: "POST", body: markerForm(marker), cookie }), { id }));

describe("markers persist and are available to recommendations (AC-056)", () => {
  it("favorite, want to try and made are independent and survive a reload", async () => {
    const id = await create();
    await mark(id, "favorite_on");
    await mark(id, "want_on");
    let page = await recipeLoader(args(req(`/recipes/${id}`), { id }));
    expect(page.markers).toMatchObject({ favorite: true, wantToTry: true, made: [] });

    // Making it clears "want to try" but never touches favorite (made ≠ liked).
    await mark(id, "made_add");
    page = await recipeLoader(args(req(`/recipes/${id}`), { id }));
    expect(page.markers.favorite).toBe(true);
    expect(page.markers.wantToTry).toBe(false);
    expect(page.markers.made).toHaveLength(1);

    await mark(id, "favorite_off");
    await mark(id, "made_add");
    page = await recipeLoader(args(req(`/recipes/${id}`), { id }));
    expect(page.markers).toMatchObject({ favorite: false, wantToTry: false });
    expect(page.markers.made).toHaveLength(2);

    await mark(id, "made_undo");
    page = await recipeLoader(args(req(`/recipes/${id}`), { id }));
    expect(page.markers.made).toHaveLength(1);
  });

  it("an unmade recipe is not marked liked, and a new recipe has no markers", async () => {
    const id = await create();
    expect(await services.markers.get(id)).toEqual({ favorite: false, wantToTry: false, made: [] });
    expect(await services.markers.signals()).toEqual([]);
  });

  it("toggles are idempotent and keep the first time a flag was set", async () => {
    const id = await create();
    await mark(id, "favorite_on");
    const [first] = await services.markers.signals();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await mark(id, "favorite_on");
    const [second] = await services.markers.signals();
    expect(second!.favoriteAt).toEqual(first!.favoriteAt);
    // Undo with nothing to undo is harmless.
    await mark(id, "made_undo");
    await mark(id, "made_undo");
    expect((await services.markers.get(id)).made).toEqual([]);
  });

  it("signals give recommendation logic counts and recency for active recipes only", async () => {
    const a = await create({ title: "A" });
    const b = await create({ title: "B" });
    const c = await create({ title: "C" });
    await create({ title: "Untouched" });
    await mark(a, "favorite_on");
    await mark(a, "made_add");
    await mark(a, "made_add");
    await mark(b, "want_on");
    await mark(c, "made_add");
    await services.catalog.remove(c, actor);

    const signals = await services.markers.signals();
    const byId = Object.fromEntries(signals.map((s) => [s.recipeId, s]));
    expect(Object.keys(byId).sort()).toEqual([a, b].sort());
    expect(byId[a]).toMatchObject({ favorite: true, wantToTry: false, madeCount: 2 });
    expect(byId[a]!.lastMadeAt).toBeInstanceOf(Date);
    expect(byId[a]!.favoriteAt).toBeInstanceOf(Date);
    expect(byId[b]).toMatchObject({ favorite: false, wantToTry: true, madeCount: 0, lastMadeAt: null });
  });

  it("changing a marker never creates a recipe version or changes the recipe", async () => {
    const id = await create();
    const before = await services.catalog.get(id);
    await mark(id, "favorite_on");
    await mark(id, "made_add");
    const after = await services.catalog.get(id);
    expect(after).toEqual(before);
    expect(await services.catalog.history(id)).toHaveLength(1);
  });
});

describe("only admins change markers (D3, AC-064)", () => {
  it("signed-out (401) and non-admin (403) requests are refused and change nothing", async () => {
    const id = await create();
    const someone = await sessionCookieFor(services, "someone@example.com");
    expect(await status(mark(id, "favorite_on", ""))).toBe(401);
    expect(await status(mark(id, "favorite_on", someone))).toBe(403);
    expect(await services.markers.get(id)).toEqual({ favorite: false, wantToTry: false, made: [] });
  });

  it("markers are public to read", async () => {
    const id = await create();
    await mark(id, "favorite_on");
    const page = await recipeLoader(args(req(`/recipes/${id}`), { id }));
    expect(page.markers.favorite).toBe(true);
  });

  it("rejects unknown marker actions and missing or deleted recipes", async () => {
    const id = await create();
    expect(await status(mark(id, "liked"))).toBe(400);
    expect(await status(mark("nope", "favorite_on"))).toBe(404);
    await services.catalog.remove(id, actor);
    expect(await status(mark(id, "favorite_on"))).toBe(404);
  });
});

describe("serving adjustment never changes the saved recipe (AC-054)", () => {
  it("the page serves the original amounts and yield; scaling happens in the browser only", async () => {
    const id = await create();
    const page = await recipeLoader(args(req(`/recipes/${id}?servings=4`), { id }));
    expect(page.entry.ingredients[0]).toEqual({ quantity: "6 oz", item: "noodles" });
    expect(page.entry.yieldText).toBe("Serves 2");
    // schema.org Recipe markup (D10/D13) keeps the original amounts.
    expect(page.schemaJson).toContain("6 oz noodles");
    expect(page.schemaJson).toContain('"recipeYield":"Serves 2"');
  });
});

describe("backup and restore keep feedback (AC-061)", () => {
  it("markers and made history round-trip into a fresh cookbook", async () => {
    const id = await create();
    await mark(id, "favorite_on");
    await mark(id, "want_on");
    await mark(id, "favorite_on");
    await mark(id, "made_add");
    await mark(id, "want_on");
    const original = await services.markers.get(id);
    const originalSignals = await services.markers.signals();

    const backup = JSON.parse(JSON.stringify(await exportBackupData(services.db, new Date())));
    expect(backup.tables.recipe_markers).toHaveLength(1);
    expect(backup.tables.recipe_made).toHaveLength(1);

    const fresh = createTestServices();
    for (const table of TABLE_ORDER) expect(await importRows(fresh.db, table, backup.tables[table])).toMatchObject({ ok: true });
    expect(await fresh.markers.get(id)).toEqual(original);
    expect(await fresh.markers.signals()).toEqual(originalSignals);
  });

  it("an older backup without marker tables still restores", async () => {
    const id = await create();
    const backup = JSON.parse(JSON.stringify(await exportBackupData(services.db, new Date())));
    delete backup.tables.recipe_markers;
    delete backup.tables.recipe_made;
    const fresh = createTestServices();
    for (const table of TABLE_ORDER) expect(await importRows(fresh.db, table, backup.tables[table] ?? [])).toMatchObject({ ok: true });
    expect(await fresh.catalog.get(id)).not.toBeNull();
    expect(await fresh.markers.get(id)).toEqual({ favorite: false, wantToTry: false, made: [] });
  });

  it("rejects malformed marker rows", async () => {
    const fresh = createTestServices();
    expect(await importRows(fresh.db, "recipe_markers", [{ recipeId: "x", favoriteAt: "yesterday", updatedAt: 1 }])).toMatchObject({ ok: false });
    expect(await importRows(fresh.db, "recipe_made", [{ id: "m", recipeId: "x" }])).toMatchObject({ ok: false });
  });
});
