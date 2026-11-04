import { serializeSignedCookie } from "better-call";
import { beforeEach, describe, expect, it } from "vitest";
import { createRouterContext } from "../../app/context";
import { action as deletedAction, loader as deletedLoader } from "../../app/routes/deleted";
import { loader as homeLoader } from "../../app/routes/home";
import { action as editAction, loader as editLoader } from "../../app/routes/recipe-edit";
import { action as newAction, loader as newLoader } from "../../app/routes/recipe-new";
import { loader as recipeLoader } from "../../app/routes/recipe";
import { action as themeAction } from "../../app/routes/theme";
import type { Services } from "../../server/app";
import { ADMIN_EMAIL, BASE_URL, createTestServices } from "../helpers/services";

let services: Services;

async function cookieFor(email: string, name = "Someone") {
  const ctx = await services.auth.$context;
  const id = crypto.randomUUID();
  const now = new Date();
  // Insert directly: stands in for a completed Google sign-in.
  const { user } = await import("../../server/db/auth-schema");
  await services.db.insert(user).values({ id, email, name, emailVerified: true, createdAt: now, updatedAt: now });
  const session = await ctx.internalAdapter.createSession(id);
  return (await serializeSignedCookie("better-auth.session_token", session.token, ctx.secret)).split(";")[0]!;
}

function form(fields: Record<string, string | string[]>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
  }
  return body;
}

function post(path: string, body: FormData, cookie?: string) {
  return new Request(`${BASE_URL}${path}`, { method: "POST", body, headers: cookie ? { Cookie: cookie } : {} });
}

function get(path: string, cookie?: string) {
  return new Request(`${BASE_URL}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    const result = await promise;
    return result instanceof Response ? result.status : 200;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    // React Router's data(..., { status }) helper
    const init = (thrown as { init?: { status?: number } } | null)?.init;
    if (init?.status) return init.status;
    throw thrown;
  }
}

const recipeFields = {
  kind: "recipe",
  title: "Gochujang Butter Noodles",
  description: "Glossy noodles.",
  yieldText: "Serves 2",
  ingredientQuantity: ["6 oz", "", ""],
  ingredientItem: ["noodles", "", ""],
  steps: "Boil.\nToss.",
  tags: "Weeknight, Noodles",
  revision: "0",
};

beforeEach(() => {
  services = createTestServices();
});

const ctx = () => createRouterContext(services);
const args = (request: Request, params: Record<string, string> = {}) =>
  ({ request, params, context: ctx() }) as never;

describe("server-side authorization on every write (AC-064, AC-027)", () => {
  it("rejects signed-out writes with 401 and changes nothing", async () => {
    expect(await statusOf(newAction(args(post("/recipes/new", form(recipeFields)))))).toBe(401);
    expect((await services.catalog.browse({})).total).toBe(0);
  });

  it("rejects writes from a signed-in non-admin with 403 (AC-063)", async () => {
    const cookie = await cookieFor("someone@example.com");
    expect(await statusOf(newAction(args(post("/recipes/new", form(recipeFields), cookie))))).toBe(403);
  });

  it("rejects unauthorized edits, deletes and restores", async () => {
    const created = await services.catalog.create(
      { kind: "recipe", title: "Keep me", description: null, notes: null, yieldText: null, prepTime: null, cookTime: null, ingredients: [], steps: [], sourceUrl: null, sourceName: null, tags: [], collectionIds: [], photos: [] },
      { userId: "x" },
    );
    const id = created.ok ? created.id : "";
    expect(await statusOf(editAction(args(post(`/recipes/${id}/edit`, form({ ...recipeFields, revision: "1" })), { id })))).toBe(401);
    expect(await statusOf(editAction(args(post(`/recipes/${id}/edit`, form({ intent: "delete" })), { id })))).toBe(401);
    expect((await services.catalog.get(id))?.title).toBe("Keep me");
    await services.catalog.remove(id, { userId: "x" });
    expect(await statusOf(deletedAction(args(post("/deleted", form({ id })))))).toBe(401);
    expect(await services.catalog.get(id)).toBeNull();
  });

  it("sends signed-out visitors from admin pages to sign-in and back", async () => {
    try {
      await newLoader(args(get("/recipes/new?kind=idea")));
      expect.unreachable();
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).headers.get("Location")).toBe("/sign-in?next=%2Frecipes%2Fnew%3Fkind%3Didea");
    }
    expect(await statusOf(deletedLoader(args(get("/deleted"))))).toBe(302);
  });
});

describe("public browsing needs no sign-in (AC-001, AC-065, AC-068)", () => {
  it("shows saved entries to signed-out visitors immediately", async () => {
    const created = await services.catalog.create(
      { kind: "idea", title: "Miso caramel peaches?", description: null, notes: null, yieldText: null, prepTime: null, cookTime: null, ingredients: [], steps: [], sourceUrl: null, sourceName: null, tags: [], collectionIds: [], photos: [] },
      { userId: "x" },
    );
    const id = created.ok ? created.id : "";
    const home = await homeLoader(args(get("/")));
    expect(home.results.items.map((i) => i.title)).toEqual(["Miso caramel peaches?"]);
    const page = await recipeLoader(args(get(`/recipes/${id}`), { id }));
    expect(page.entry.title).toBe("Miso caramel peaches?");
    expect(page.schemaJson).toBeNull(); // ideas carry no Recipe markup
  });

  it("returns 404 for deleted entries", async () => {
    const created = await services.catalog.create(
      { kind: "recipe", title: "Gone", description: null, notes: null, yieldText: null, prepTime: null, cookTime: null, ingredients: [], steps: [], sourceUrl: null, sourceName: null, tags: [], collectionIds: [], photos: [] },
      { userId: "x" },
    );
    const id = created.ok ? created.id : "";
    await services.catalog.remove(id, { userId: "x" });
    expect(await statusOf(recipeLoader(args(get(`/recipes/${id}`), { id })))).toBe(404);
  });
});

describe("admin editing (AC-005, AC-009)", () => {
  let cookie: string;
  beforeEach(async () => {
    cookie = await cookieFor(ADMIN_EMAIL, "Admin");
  });

  it("creates a recipe with tags and a new collection, then shows it publicly", async () => {
    const response = (await newAction(args(post("/recipes/new", form({ ...recipeFields, newCollection: "Weeknight rotation" }), cookie)))) as Response;
    expect(response.status).toBe(303);
    const id = response.headers.get("Location")!.split("/").pop()!;
    const entry = await services.catalog.get(id);
    expect(entry).toMatchObject({
      title: "Gochujang Butter Noodles",
      ingredients: [{ quantity: "6 oz", item: "noodles" }],
      steps: ["Boil.", "Toss."],
      tags: [{ name: "Noodles" }, { name: "Weeknight" }],
      collections: [{ name: "Weeknight rotation" }],
    });
    const page = await recipeLoader(args(get(`/recipes/${id}`), { id }));
    expect(JSON.parse(page.schemaJson!)).toMatchObject({ "@type": "Recipe", recipeIngredient: ["6 oz noodles"] });
  });

  it("returns field errors with everything typed preserved (AC-048)", async () => {
    const result = (await newAction(args(post("/recipes/new", form({ ...recipeFields, title: " ", sourceUrl: "not a url" }), cookie)))) as {
      data: { errors: Record<string, string>; values: { ingredients: unknown; steps: string } };
      init: { status: number };
    };
    expect(result.init.status).toBe(400);
    expect(result.data.errors.title).toBeTruthy();
    expect(result.data.errors.sourceUrl).toBeTruthy();
    expect(result.data.values.steps).toMatch(/^Boil\.\r?\nToss\.$/);
    expect((await services.catalog.browse({})).total).toBe(0);
  });

  it("edits with a revision check and reports conflicts without losing input (AC-031)", async () => {
    const created = (await newAction(args(post("/recipes/new", form(recipeFields), cookie)))) as Response;
    const id = created.headers.get("Location")!.split("/").pop()!;
    const loaded = await editLoader(args(get(`/recipes/${id}/edit`, cookie), { id }));
    expect(loaded.values.revision).toBe(1);

    const first = (await editAction(args(post(`/recipes/${id}/edit`, form({ ...recipeFields, title: "Tab A", revision: "1" }), cookie), { id }))) as Response;
    expect(first.status).toBe(303);
    const stale = (await editAction(args(post(`/recipes/${id}/edit`, form({ ...recipeFields, title: "Tab B", revision: "1" }), cookie), { id }))) as {
      data: { errors: { form: string }; values: { title: string } };
      init: { status: number };
    };
    expect(stale.init.status).toBe(409);
    expect(stale.data.errors.form).toMatch(/changed since you opened it/);
    expect(stale.data.values.title).toBe("Tab B");
    expect((await services.catalog.get(id))?.title).toBe("Tab A");
  });

  it("deletes to the recovery view and restores", async () => {
    const created = (await newAction(args(post("/recipes/new", form(recipeFields), cookie)))) as Response;
    const id = created.headers.get("Location")!.split("/").pop()!;
    const removed = (await editAction(args(post(`/recipes/${id}/edit`, form({ intent: "delete" }), cookie), { id }))) as Response;
    expect(removed.headers.get("Location")).toBe("/deleted?removed=1");
    expect(await services.catalog.get(id)).toBeNull();
    const trash = await deletedLoader(args(get("/deleted", cookie)));
    expect(trash.entries.map((e) => e.id)).toEqual([id]);
    const restored = (await deletedAction(args(post("/deleted", form({ id }), cookie)))) as Response;
    expect(restored.headers.get("Location")).toBe(`/recipes/${id}`);
    expect((await services.catalog.get(id))?.title).toBe("Gochujang Butter Noodles");
  });
});

describe("theme preference (AC-071)", () => {
  it("stores the choice in a cookie and returns to the same page", async () => {
    const response = (await themeAction(args(post("/theme", form({ theme: "dark", returnTo: "/recipes/abc?x=1" }))))) as Response;
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/recipes/abc?x=1");
    expect(response.headers.get("Set-Cookie")).toMatch(/^theme=dark; Path=\/; Max-Age=31536000; SameSite=Lax/);
  });

  it("ignores invalid themes and off-site return paths", async () => {
    const response = (await themeAction(args(post("/theme", form({ theme: "neon", returnTo: "//evil.example" }))))) as Response;
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
});
