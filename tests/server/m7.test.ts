import { beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createRouterContext } from "../../app/context";
import { action as askAction, loader as askLoader } from "../../app/routes/ask";
import { action as prefsAction, loader as prefsLoader } from "../../app/routes/preferences";
import { loader as importLoader } from "../../app/routes/recipe-import";
import type { Services } from "../../server/app";
import { collectWebSources, createAnthropicAi } from "../../server/ai/anthropic";
import { exportBackupData, importRows, TABLE_ORDER } from "../../server/backup";
import type { RecommendInput, WebSourceSeen } from "../../server/core/ai";
import { buildDigests, sameStatement } from "../../server/core/preferences";
import { normalizeUrl } from "../../server/core/recommendations";
import { validateEntry } from "../../server/core/recipes";
import { FakeAi } from "../helpers/fake-ai";
import { ADMIN_EMAIL, BASE_URL, createTestServices, sessionCookieFor } from "../helpers/services";

// M7 — Recommendations and preferences: AC-015, AC-016, AC-017, AC-034,
// AC-035, plus the admin-only rule for paid AI (AC-066/067) and backups.

let services: Services;
let ai: FakeAi;
let admin: string;
const actor = { userId: "admin" };

beforeEach(async () => {
  ai = new FakeAi();
  services = createTestServices({ ai });
  admin = await sessionCookieFor(services, ADMIN_EMAIL);
});

const args = (request: Request, params: Record<string, string> = {}) =>
  ({ request, params, context: createRouterContext(services) }) as never;

const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${BASE_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(init.cookie ? { Cookie: init.cookie } : {}) } });

const post = (path: string, fields: Record<string, string>, cookie?: string) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return req(path, { method: "POST", body, cookie });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose bodies in assertions
async function run(promise: Promise<unknown>): Promise<{ status: number; body: any }> {
  let result: unknown;
  try {
    result = await promise;
  } catch (thrown) {
    result = thrown;
  }
  if (result instanceof Response) return { status: result.status, body: await result.text() };
  const wrapped = result as { type?: string; data?: unknown; init?: { status?: number } };
  if (wrapped && wrapped.type === "DataWithResponseInit") return { status: wrapped.init?.status ?? 200, body: wrapped.data };
  return { status: 200, body: result };
}

async function createRecipe(title: string, items: string[] = [], extra: { sourceUrl?: string; tags?: string[] } = {}) {
  const valid = validateEntry({
    kind: "recipe",
    title,
    ingredients: items.map((item) => ({ quantity: "1 cup", item })),
    steps: [],
    tags: extra.tags ?? [],
    collectionIds: [],
    sourceUrl: extra.sourceUrl ?? null,
  });
  if (!valid.ok) throw new Error(JSON.stringify(valid));
  const created = await services.catalog.create(valid.value, actor);
  if (!created.ok) throw new Error();
  return created.id;
}

const recommendInput = () => ai.calls.find((c) => c.method === "recommend")?.input as RecommendInput;

describe("paid AI is admin-only, checked before any Claude call (AC-066, AC-067)", () => {
  it("Ask AI: the page sends visitors to sign in, refuses non-admins, and the request refuses both without calling Claude", async () => {
    await createRecipe("Noodles");
    const viewer = await sessionCookieFor(services, "someone@example.com");
    expect((await run(askLoader(args(req("/ask"))))).status).toBe(302);
    expect((await run(askLoader(args(req("/ask", { cookie: viewer }))))).status).toBe(403);
    expect((await run(askAction(args(post("/ask", { question: "dinner", web: "on" }))))).status).toBe(401);
    expect((await run(askAction(args(post("/ask", { question: "dinner", web: "on" }, viewer))))).status).toBe(403);
    expect(ai.calls).toHaveLength(0);
  });

  it("Preferences: anyone can read the profile, but refresh and corrections refuse signed-out and non-admin requests", async () => {
    const id = await createRecipe("Noodles");
    await services.preferences.add("Likes noodles", actor);
    const viewer = await sessionCookieFor(services, "someone@example.com");
    const page = await run(prefsLoader(args(req("/preferences"))));
    expect(page.status).toBe(200);
    expect(page.body.confirmed.map((p: { statement: string }) => p.statement)).toEqual(["Likes noodles"]);
    for (const intent of ["refresh", "add", "confirm", "reject", "edit", "forget"]) {
      expect((await run(prefsAction(args(post("/preferences", { intent, id, statement: "x" }))))).status).toBe(401);
      expect((await run(prefsAction(args(post("/preferences", { intent, id, statement: "x" }, viewer))))).status).toBe(403);
    }
    expect(ai.calls).toHaveLength(0);
    expect((await services.preferences.view()).confirmed).toHaveLength(1);
  });

  it("without an API key both features say AI isn't set up (AC-036)", async () => {
    services = createTestServices();
    admin = await sessionCookieFor(services, ADMIN_EMAIL);
    await createRecipe("Noodles");
    const ask = await run(askAction(args(post("/ask", { question: "dinner" }, admin))));
    expect(ask.status).toBe(503);
    expect(ask.body.error).toMatch(/aren't set up/);
    const refresh = await run(prefsAction(args(post("/preferences", { intent: "refresh" }, admin))));
    expect(refresh.status).toBe(503);
  });
});

describe("preference profile (AC-016, AC-017, AC-035)", () => {
  it("infers preferences with evidence from the catalog and markers, dropping medical guesses and made-up evidence (AC-016)", async () => {
    const noodles = await createRecipe("Gochujang Noodles", ["gochujang", "noodles"], { tags: ["Korean"] });
    const chili = await createRecipe("Bean Chili", ["beans"]);
    await services.markers.apply(noodles, "favorite_on", actor);
    await services.markers.apply(chili, "made_add", actor);
    ai.profile = {
      ok: true,
      value: {
        preferences: [
          { statement: "Likes spicy Korean flavors", confidence: "high", evidence: [noodles, "made-up-id"] },
          { statement: "Avoids gluten due to celiac disease", confidence: "low", evidence: [chili] },
          { statement: "Loves anchovies", confidence: "low", evidence: ["made-up-id"] },
          { statement: "Enjoys hearty one-pot meals", confidence: "medium", evidence: [chili] },
        ],
        note: null,
      },
    };
    const response = await run(prefsAction(args(post("/preferences", { intent: "refresh" }, admin))));
    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/2 suggestions/);

    const input = ai.calls[0]!.input as { recipes: { id: string; feedback: unknown; ingredients: string[] }[] };
    // Favorites lead the material, and feedback travels with each recipe.
    expect(input.recipes[0]!.id).toBe(noodles);
    expect(input.recipes[0]!.feedback).toMatchObject({ favorite: true, wantToTry: false, madeCount: 0 });
    expect(input.recipes.find((r) => r.id === chili)!.feedback).toMatchObject({ madeCount: 1, lastMadeDaysAgo: 0 });
    expect(input.recipes[0]!.ingredients).toEqual(["gochujang", "noodles"]); // names only, no amounts

    const view = await services.preferences.view();
    expect(view.suggested.map((p) => [p.statement, p.evidence])).toEqual([
      ["Likes spicy Korean flavors", [noodles]],
      ["Enjoys hearty one-pot meals", [chili]],
    ]);
    // Small cookbook: the profile says it's a rough guess.
    expect(view.lastRefresh).toMatchObject({ recipeCount: 2 });
    expect(view.lastRefresh!.note).toMatch(/only 2 recipes/);

    const page = await run(prefsLoader(args(req("/preferences"))));
    expect(page.body.titles[noodles]).toBe("Gochujang Noodles");
  });

  it("a refresh never brings back a rejected or corrected inference, and keeps confirmed ones (AC-017, AC-035)", async () => {
    const noodles = await createRecipe("Gochujang Noodles", ["gochujang"]);
    const chili = await createRecipe("Bean Chili", ["beans"]);
    const soup = await createRecipe("Miso Soup", ["miso"]);
    ai.profile = {
      ok: true,
      value: {
        preferences: [
          { statement: "Likes spicy Korean flavors", confidence: "high", evidence: [noodles] },
          { statement: "Enjoys hearty one-pot meals", confidence: "medium", evidence: [chili] },
          { statement: "Likes Japanese soups", confidence: "low", evidence: [soup] },
        ],
        note: null,
      },
    };
    await services.preferences.refresh(actor);
    const [korean, hearty, japanese] = (await services.preferences.view()).suggested;

    expect((await run(prefsAction(args(post("/preferences", { intent: "edit", id: korean!.id, statement: "Likes mild Korean flavors, not too spicy" }, admin))))).status).toBe(200);
    expect((await run(prefsAction(args(post("/preferences", { intent: "reject", id: hearty!.id }, admin))))).status).toBe(200);
    expect((await run(prefsAction(args(post("/preferences", { intent: "confirm", id: japanese!.id }, admin))))).status).toBe(200);
    await run(prefsAction(args(post("/preferences", { intent: "add", statement: "We like dinners under 45 minutes" }, admin))));

    // The AI repeats itself, with slightly different wording.
    ai.profile = {
      ok: true,
      value: {
        preferences: [
          { statement: "Likes spicy Korean flavours", confidence: "high", evidence: [noodles] },
          { statement: "Enjoys hearty one-pot meals.", confidence: "medium", evidence: [chili] },
          { statement: "Likes Japanese soups", confidence: "low", evidence: [soup] },
          { statement: "Often cooks with beans", confidence: "low", evidence: [chili] },
        ],
        note: null,
      },
    };
    await run(prefsAction(args(post("/preferences", { intent: "refresh" }, admin))));
    const second = ai.calls.filter((c) => c.method === "inferPreferences")[1]!.input as { confirmed: string[]; rejected: string[] };
    expect(second.rejected).toEqual(["Enjoys hearty one-pot meals"]);
    expect(second.confirmed).toEqual(["Likes mild Korean flavors, not too spicy", "Likes Japanese soups", "We like dinners under 45 minutes"]);

    const view = await services.preferences.view();
    expect(view.suggested.map((p) => p.statement)).toEqual(["Often cooks with beans"]);
    expect(view.rejected.map((p) => p.statement)).toEqual(["Enjoys hearty one-pot meals"]);
    expect(view.confirmed.map((p) => [p.statement, p.inferredStatement, p.source])).toEqual([
      ["Likes mild Korean flavors, not too spicy", "Likes spicy Korean flavors", "ai"],
      ["Likes Japanese soups", "Likes Japanese soups", "ai"],
      ["We like dinners under 45 minutes", null, "owner"],
    ]);

    // Later recommendations use the correction, and treat the rejection as not true (AC-017).
    await run(askAction(args(post("/ask", { question: "dinner" }, admin))));
    const input = recommendInput();
    expect(input.preferences).toEqual([
      { statement: "Likes mild Korean flavors, not too spicy", confirmed: true },
      { statement: "Likes Japanese soups", confirmed: true },
      { statement: "We like dinners under 45 minutes", confirmed: true },
      { statement: "Often cooks with beans", confirmed: false },
    ]);
    expect(input.rejected).toEqual(["Enjoys hearty one-pot meals"]);

    // "Allow again" forgets the rejection; deleting an owner item removes it.
    await run(prefsAction(args(post("/preferences", { intent: "forget", id: hearty!.id }, admin))));
    const owner = (await services.preferences.view()).confirmed.find((p) => p.source === "owner")!;
    await run(prefsAction(args(post("/preferences", { intent: "reject", id: owner.id }, admin))));
    const after = await services.preferences.view();
    expect(after.rejected).toHaveLength(0);
    expect(after.confirmed.map((p) => p.source)).toEqual(["ai", "ai"]);
  });

  it("explains failures and invalid input without changing the profile", async () => {
    let response = await run(prefsAction(args(post("/preferences", { intent: "refresh" }, admin))));
    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/Add some recipes first/);
    expect(ai.calls).toHaveLength(0);

    await createRecipe("Noodles");
    await services.preferences.add("Likes noodles", actor);
    ai.profile = { ok: false, reason: "failed", message: "The AI service is busy right now." };
    response = await run(prefsAction(args(post("/preferences", { intent: "refresh" }, admin))));
    expect(response.status).toBe(502);
    expect((await services.preferences.view()).confirmed).toHaveLength(1);

    expect((await run(prefsAction(args(post("/preferences", { intent: "add", statement: "  " }, admin))))).status).toBe(422);
    expect((await run(prefsAction(args(post("/preferences", { intent: "add", statement: "x".repeat(301) }, admin))))).status).toBe(422);
    expect((await run(prefsAction(args(post("/preferences", { intent: "confirm", id: "nope" }, admin))))).status).toBe(404);
  });

  it("matches restated preferences but not different ones", () => {
    expect(sameStatement("Likes spicy Korean flavors", "likes spicy korean flavours.")).toBe(true);
    expect(sameStatement("Enjoys hearty one-pot meals", "Enjoys hearty one-pot meals.")).toBe(true);
    expect(sameStatement("Prefers quick weeknight dinners", "Prefers quick dinners on weeknights")).toBe(true);
    expect(sameStatement("Likes spicy food", "Likes Japanese soups")).toBe(false);
  });
});

describe("Ask AI (AC-015, AC-034)", () => {
  it("returns ranked saved recipes and verified web discoveries, labeled, with sources and reasons", async () => {
    const noodles = await createRecipe("Gochujang Noodles", ["gochujang"]);
    const chili = await createRecipe("Bean Chili", ["beans"]);
    const saved = await createRecipe("Saved Eggplant", ["eggplant"], { sourceUrl: "https://www.example.com/eggplant/" });
    await services.markers.apply(chili, "want_on", actor);
    const sources: WebSourceSeen[] = [
      { url: "https://recipes.example.org/miso", title: "Miso Glazed Eggplant", read: true },
      { url: "https://recipes.example.org/soup", title: "Soup", read: false },
      { url: "https://example.com/eggplant", title: "Eggplant", read: false },
    ];
    ai.recommendation = {
      ok: true,
      value: {
        saved: [
          { recipeId: chili, reason: "On your want-to-try list." },
          { recipeId: "invented", reason: "Not real." },
          { recipeId: noodles, reason: "A favorite flavor." },
          { recipeId: chili, reason: "Duplicate." },
        ],
        web: [
          { title: "Miso Glazed Eggplant", url: "https://recipes.example.org/miso#top", sourceName: "Example Recipes", reason: "Similar flavors." },
          { title: "Soup", url: "https://recipes.example.org/soup", sourceName: "", reason: "Warming." },
          { title: "Made up", url: "https://nowhere.example.net/pie", sourceName: "Nowhere", reason: "Invented." },
          { title: "Bad", url: "javascript:alert(1)", sourceName: "x", reason: "x" },
          { title: "Already saved", url: "http://example.com/eggplant", sourceName: "Example", reason: "You saved this one." },
        ],
        note: "Nothing saved is very quick.",
        webSources: sources,
      },
    };
    const response = await run(askAction(args(post("/ask", { question: "  something warming  ", web: "on" }, admin))));
    expect(response.status).toBe(200);
    const result = response.body.result;
    expect(result.saved).toEqual([
      { kind: "saved", recipeId: chili, title: "Bean Chili", reason: "On your want-to-try list.", feedback: { favorite: false, wantToTry: true, madeCount: 0 } },
      { kind: "saved", recipeId: noodles, title: "Gochujang Noodles", reason: "A favorite flavor.", feedback: null },
      { kind: "saved", recipeId: saved, title: "Saved Eggplant", reason: "You saved this one.", feedback: null },
    ]);
    expect(result.web).toEqual([
      { kind: "web", title: "Miso Glazed Eggplant", url: "https://recipes.example.org/miso", sourceName: "Example Recipes", reason: "Similar flavors.", pageRead: true },
      { kind: "web", title: "Soup", url: "https://recipes.example.org/soup", sourceName: "recipes.example.org", reason: "Warming.", pageRead: false },
    ]);
    expect(result.droppedUnverified).toBe(2);
    expect(result.note).toBe("Nothing saved is very quick.");

    const input = recommendInput();
    expect(input.question).toBe("something warming");
    expect(input.includeWeb).toBe(true);
    // Want-to-try recipes lead the material; markers travel as feedback.
    expect(input.recipes[0]).toMatchObject({ id: chili, feedback: { wantToTry: true } });
  });

  it("without the web option, web suggestions are never shown", async () => {
    const id = await createRecipe("Noodles");
    ai.recommendation = {
      ok: true,
      value: {
        saved: [{ recipeId: id, reason: "Quick." }],
        web: [{ title: "X", url: "https://a.example/x", sourceName: "A", reason: "x" }],
        note: null,
        webSources: [{ url: "https://a.example/x", title: "X", read: true }],
      },
    };
    const response = await run(askAction(args(post("/ask", { question: "" }, admin))));
    expect(response.body.result.web).toEqual([]);
    expect(recommendInput()).toMatchObject({ includeWeb: false, question: "What should I cook next?" });
  });

  it("explains an empty cookbook, a long request and AI errors, keeping the request", async () => {
    let response = await run(askAction(args(post("/ask", { question: "dinner" }, admin))));
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ ok: false, question: "dinner", includeWeb: false });
    await createRecipe("Noodles");
    response = await run(askAction(args(post("/ask", { question: "x".repeat(501) }, admin))));
    expect(response.status).toBe(422);
    expect(ai.calls).toHaveLength(0);
    ai.recommendation = { ok: false, reason: "failed", message: "The AI service is busy right now." };
    response = await run(askAction(args(post("/ask", { question: "dinner", web: "on" }, admin))));
    expect(response).toMatchObject({ status: 502, body: { ok: false, error: "The AI service is busy right now.", question: "dinner", includeWeb: true } });
  });

  it("'Save to cookbook' opens the link import with the page filled in (D2)", async () => {
    const page = await run(importLoader(args(req("/recipes/import?url=https%3A%2F%2Frecipes.example.org%2Fmiso", { cookie: admin }))));
    expect(page.body.prefillUrl).toBe("https://recipes.example.org/miso");
    const bad = await run(importLoader(args(req("/recipes/import?url=javascript%3Aalert(1)", { cookie: admin }))));
    expect(bad.body.prefillUrl).toBe("");
  });
});

describe("helpers", () => {
  it("normalizes links for matching", () => {
    expect(normalizeUrl("http://WWW.Example.com/a/#x")).toBe("https://example.com/a");
    expect(normalizeUrl("ftp://example.com")).toBeNull();
    expect(normalizeUrl("https://user:pw@example.com")).toBeNull();
  });

  it("caps and orders digests: favorites, want to try, made, then newest", () => {
    const source = (id: string) => ({ id, kind: "recipe" as const, title: id, description: null, tags: [], ingredients: [], prepTime: null, cookTime: null, sourceUrl: null });
    const now = new Date("2026-11-04T12:00:00Z");
    const digests = buildDigests([source("new"), source("made"), source("want"), source("fav")], [
      { recipeId: "made", favorite: false, favoriteAt: null, wantToTry: false, wantToTryAt: null, madeCount: 2, lastMadeAt: new Date("2026-11-01T12:00:00Z") },
      { recipeId: "want", favorite: false, favoriteAt: null, wantToTry: true, wantToTryAt: now, madeCount: 0, lastMadeAt: null },
      { recipeId: "fav", favorite: true, favoriteAt: now, wantToTry: false, wantToTryAt: null, madeCount: 0, lastMadeAt: null },
    ], now);
    expect(digests.map((d) => d.id)).toEqual(["fav", "want", "made", "new"]);
    expect(digests[2]!.feedback).toEqual({ favorite: false, wantToTry: false, madeCount: 2, lastMadeDaysAgo: 3 });
  });

  it("collects only pages the web tools returned (AC-034)", () => {
    const seen = new Map<string, WebSourceSeen>();
    collectWebSources(
      [
        { type: "text", text: "See https://invented.example/x", citations: [{ type: "web_search_result_location", url: "https://cited.example/a", title: "Cited" }] },
        { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://found.example/a", title: "Found" }] },
        { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
        { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://found.example/a", content: { type: "document", title: "Found page" } } },
        { type: "tool_use", name: "submit_suggestions", input: { url: "https://invented.example/y" } },
      ],
      seen,
    );
    expect([...seen.values()]).toEqual([
      { url: "https://cited.example/a", title: "Cited", read: false },
      { url: "https://found.example/a", title: "Found page", read: true },
    ]);
  });
});

describe("Claude adapter for Ask AI", () => {
  function fakeClient(replies: Partial<Anthropic.Beta.BetaMessage>[]) {
    const requests: Anthropic.Beta.MessageCreateParams[] = [];
    const client = {
      beta: {
        messages: {
          create: async (params: Anthropic.Beta.MessageCreateParams) => {
            requests.push(structuredClone(params));
            const reply = replies.shift();
            if (!reply) throw new Error("no more replies");
            return { id: "m", type: "message", role: "assistant", model: params.model, stop_sequence: null, usage: {}, ...reply };
          },
        },
      },
    } as unknown as Anthropic;
    return { client, requests };
  }
  const input: RecommendInput = {
    question: "dinner",
    recipes: [{ id: "r1", kind: "recipe", title: "Noodles", description: null, tags: [], ingredients: ["noodles"], prepTime: null, cookTime: null, feedback: null }],
    preferences: [{ statement: "Likes noodles", confirmed: true }],
    rejected: ["Hates rice"],
    includeWeb: true,
    today: "2026-11-04",
  };
  const submit = {
    type: "tool_use",
    id: "t",
    name: "submit_suggestions",
    input: { saved: [{ recipe_id: "r1", reason: "Quick." }], web: [{ title: "P", url: "https://found.example/a", source_name: "F", reason: "New." }], note: "" },
  };

  it("resumes a paused turn, keeps the web results, and reads the submitted answer", async () => {
    const { client, requests } = fakeClient([
      { stop_reason: "pause_turn", content: [{ type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", url: "https://found.example/a", title: "F" }] }] as never },
      { stop_reason: "tool_use", content: [submit] as never },
    ]);
    const result = await createAnthropicAi({ apiKey: "k", client }).recommend(input);
    expect(result).toEqual({
      ok: true,
      value: {
        saved: [{ recipeId: "r1", reason: "Quick." }],
        web: [{ title: "P", url: "https://found.example/a", sourceName: "F", reason: "New." }],
        note: null,
        webSources: [{ url: "https://found.example/a", title: "F", read: false }],
      },
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.model).toBe("claude-opus-5-5");
    expect(requests[0]!.tools!.map((t) => (t as { type?: string; name?: string }).type ?? (t as { name?: string }).name)).toEqual(["web_search_20260209", "web_fetch_20260209", "submit_suggestions"]);
    expect(requests[1]!.messages).toHaveLength(2); // the paused turn sent back, no extra user message
    const prompt = JSON.stringify(requests[0]!.messages);
    expect(prompt).toContain("Likes noodles (confirmed by the owner)");
    expect(prompt).toContain("Hates rice");
  });

  it("asks once more when the model stops without submitting, and leaves out web tools when not wanted", async () => {
    const { client, requests } = fakeClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "Try noodles." }] as never },
      { stop_reason: "tool_use", content: [submit] as never },
    ]);
    const result = await createAnthropicAi({ apiKey: "k", client }).recommend({ ...input, includeWeb: false });
    expect(result.ok).toBe(true);
    expect(requests[0]!.tools!.map((t) => (t as { name?: string }).name)).toEqual(["submit_suggestions"]);
    expect(requests[1]!.messages.at(-1)).toMatchObject({ role: "user" });
  });

  it("reports a refusal plainly", async () => {
    const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);
    expect(await createAnthropicAi({ apiKey: "k", client }).recommend(input)).toMatchObject({ ok: false, reason: "refused" });
  });
});

describe("backups keep the preference profile", () => {
  it("exports and restores preferences and refresh history; older backups without them still restore", async () => {
    const id = await createRecipe("Noodles");
    ai.profile = { ok: true, value: { preferences: [{ statement: "Likes noodles", confidence: "high", evidence: [id] }], note: null } };
    await services.preferences.refresh(actor);
    const suggestion = (await services.preferences.view()).suggested[0]!;
    await services.preferences.reject(suggestion.id, actor);
    await services.preferences.add("Quick dinners", actor);

    const backup = JSON.parse(JSON.stringify(await exportBackupData(services.db, new Date())));
    expect(backup.tables.preferences).toHaveLength(2);
    expect(backup.tables.preference_refreshes).toHaveLength(1);

    const fresh = createTestServices();
    for (const table of TABLE_ORDER) expect(await importRows(fresh.db, table, backup.tables[table])).toMatchObject({ ok: true });
    const view = await fresh.preferences.view();
    expect(view.rejected.map((p) => [p.statement, p.evidence])).toEqual([["Likes noodles", [id]]]);
    expect(view.confirmed.map((p) => p.statement)).toEqual(["Quick dinners"]);
    expect(view.lastRefresh).toMatchObject({ recipeCount: 1 });

    const older = JSON.parse(JSON.stringify(backup));
    delete older.tables.preferences;
    delete older.tables.preference_refreshes;
    const another = createTestServices();
    for (const table of TABLE_ORDER) expect(await importRows(another.db, table, older.tables[table] ?? [])).toMatchObject({ ok: true });
    expect(await importRows(another.db, "preferences", [{ id: "p", statement: "x", source: "robot" }])).toMatchObject({ ok: false });
  });
});
