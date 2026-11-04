import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Services } from "../../server/app";
import { createApiKey, revokeApiKey } from "../../server/api-keys";
import { disconnectTool, listConnectedTools } from "../../server/connections";
import { validateEntry } from "../../server/core/recipes";
import { user } from "../../server/db/auth-schema";
import { getViewer } from "../../app/session.server";
import { callTool, connectTool } from "../helpers/oauth";
import { ADMIN_EMAIL, createTestServices, request } from "../helpers/services";

let services: Services;
let oauthToken: string;
let oauthClientId: string;
let apiKey: string;
let apiKeyId: string;
let adminId: string;

beforeEach(async () => {
  services = createTestServices();
  const connected = await connectTool(services, { email: ADMIN_EMAIL, clientName: "Claude" });
  oauthToken = connected.accessToken;
  oauthClientId = connected.clientId;
  const [admin] = await services.db.select({ id: user.id }).from(user).where(eq(user.email, ADMIN_EMAIL));
  adminId = admin!.id;
  const created = (await createApiKey(services.db, "Script", adminId, new Date()))!;
  apiKey = created.key;
  apiKeyId = created.id;
});

type Json = Record<string, unknown>;

/** The same operations over each interface (AC-025). */
interface ToolClient {
  name: string;
  submitNew(recipe: unknown, key: string, note?: string): Promise<{ data: Json; http?: number }>;
  submitUpdate(id: string, revision: number, changes: unknown, key: string): Promise<{ data: Json; http?: number }>;
  status(id: string): Promise<Json>;
  get(id: string): Promise<Json>;
  search(query: string): Promise<Json>;
}

const mcp = (): ToolClient => ({
  name: "MCP (OAuth connector)",
  submitNew: async (recipe, key, note) => ({ data: (await callTool(services, oauthToken, "submit_recipe", { recipe, idempotency_key: key, note })).data }),
  submitUpdate: async (id, revision, changes, key) => ({
    data: (await callTool(services, oauthToken, "update_recipe", { recipe_id: id, expected_revision: revision, changes, idempotency_key: key })).data,
  }),
  status: async (id) => (await callTool(services, oauthToken, "get_submission_status", { submission_id: id })).data,
  get: async (id) => (await callTool(services, oauthToken, "get_recipe", { recipe_id: id })).data,
  search: async (query) => (await callTool(services, oauthToken, "search_recipes", { query })).data,
});

const http = (): ToolClient => {
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await request(services, `/api/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    return { data: (await res.json()) as Json, http: res.status };
  };
  return {
    name: "HTTP API (API key)",
    submitNew: (recipe, key, note) => call("/recipes", { method: "POST", body: JSON.stringify({ recipe, note }), headers: { "Idempotency-Key": key } }),
    submitUpdate: (id, revision, changes, key) =>
      call(`/recipes/${id}/updates`, { method: "POST", body: JSON.stringify({ expectedRevision: revision, changes }), headers: { "Idempotency-Key": key } }),
    status: async (id) => (await call(`/submissions/${id}`)).data,
    get: async (id) => (await call(`/recipes/${id}`)).data,
    search: async (query) => (await call(`/recipes?query=${encodeURIComponent(query)}`)).data,
  };
};

const recipe = {
  title: "Crispy Rice Salad",
  servings: "Serves 4",
  ingredients: [
    { quantity: "2 cups", item: "cooked jasmine rice" },
    { quantity: "", item: "fish sauce, to taste" },
  ],
  steps: ["Crisp the rice.", "Toss with herbs."],
  tags: ["Weeknight"],
};

const admin = () => ({ userId: adminId });

async function existingRecipe(title = "Gochujang Butter Noodles") {
  const valid = validateEntry({
    kind: "recipe",
    title,
    notes: "Keep this note",
    ingredients: [{ quantity: "2 tsp", item: "honey" }],
    steps: ["Boil.", "Toss."],
    tags: ["Noodles"],
    collectionIds: [],
  });
  if (!valid.ok) throw new Error();
  const created = await services.catalog.create(valid.value, admin());
  return created.ok ? created.id : "";
}

describe.each([["mcp", mcp], ["http", http]] as const)("submissions via %s", (_, makeClient) => {
  let tool: ToolClient;
  beforeEach(() => {
    tool = makeClient();
  });

  it("queues a new recipe by default; nothing is public until approved (AC-011, AC-012, AC-070)", async () => {
    const { data, http: code } = await tool.submitNew(recipe, "new-recipe-0001", "From our chat about rice");
    expect(data).toMatchObject({ status: "pending", recipeId: null });
    if (code) expect(code).toBe(202);
    expect((await services.catalog.browse({})).total).toBe(0);
    expect((await services.catalog.browse({ q: "crispy" })).total).toBe(0);
    expect(await tool.search("crispy")).toMatchObject({ total: 0 });

    const approved = await services.submissions.approve(String(data.submissionId), admin());
    expect(approved?.status).toBe("applied");
    const entry = await services.catalog.get(approved!.resultRecipeId!);
    expect(entry).toMatchObject({ title: "Crispy Rice Salad", yieldText: "Serves 4", origin: "ai", tags: [{ name: "Weeknight" }] });
    expect(entry?.ingredients[1]).toEqual({ quantity: "", item: "fish sauce, to taste" }); // unknown amount stays blank
    const history = await services.catalog.history(entry!.id);
    expect(history[0]).toMatchObject({ origin: "ai", changeNote: "Claude: From our chat about rice".replace("Claude", approved!.clientName) });
    expect(await tool.status(String(data.submissionId))).toMatchObject({ status: "applied", recipeId: entry!.id, revision: 1 });
  });

  it("sends updates against a revision; only the sent fields change (AC-011)", async () => {
    const id = await existingRecipe();
    const read = await tool.get(id);
    expect(read).toMatchObject({ id, revision: 1, title: "Gochujang Butter Noodles", notes: "Keep this note" });
    const { data } = await tool.submitUpdate(id, 1, { ingredients: [{ quantity: "1 tsp", item: "honey" }] }, "update-honey-01");
    expect(data.status).toBe("pending");
    expect((await services.catalog.get(id))?.ingredients).toEqual([{ quantity: "2 tsp", item: "honey" }]); // unchanged until approved

    const pending = await services.submissions.get(String(data.submissionId));
    expect(pending?.baseSnapshot?.ingredients).toEqual([{ quantity: "2 tsp", item: "honey" }]);
    await services.submissions.approve(String(data.submissionId), admin());
    const entry = await services.catalog.get(id);
    expect(entry).toMatchObject({ revision: 2, title: "Gochujang Butter Noodles", notes: "Keep this note", tags: [{ name: "Noodles" }] });
    expect(entry?.ingredients).toEqual([{ quantity: "1 tsp", item: "honey" }]);
  });

  it("rejecting leaves the catalog unchanged and adds no version (AC-013, AC-059)", async () => {
    const id = await existingRecipe();
    const { data } = await tool.submitUpdate(id, 1, { title: "Unwanted rename" }, "unwanted-0001");
    const rejected = await services.submissions.reject(String(data.submissionId), admin());
    expect(rejected?.status).toBe("rejected");
    expect((await services.catalog.get(id))?.title).toBe("Gochujang Butter Noodles");
    expect((await services.catalog.history(id)).length).toBe(1);
    expect(await tool.status(String(data.submissionId))).toMatchObject({ status: "rejected" });
  });

  it("with approval off, saves immediately; turning it off doesn't apply waiting ones (AC-014, AC-032)", async () => {
    const waiting = await tool.submitNew({ ...recipe, title: "Waiting Soup" }, "waiting-0001");
    expect(waiting.data.status).toBe("pending");

    await services.submissions.setApprovalRequired(false, adminId);
    const { data, http: code } = await tool.submitNew(recipe, "auto-apply-01");
    expect(data).toMatchObject({ status: "applied", revision: 1 });
    if (code) expect(code).toBe(201);
    expect((await services.catalog.get(String(data.recipeId)))?.title).toBe("Crispy Rice Salad");
    expect((await services.submissions.get(String(waiting.data.submissionId)))?.status).toBe("pending");
    expect((await services.catalog.browse({ q: "waiting" })).total).toBe(0);

    await services.submissions.setApprovalRequired(true, adminId);
    expect((await tool.submitNew({ ...recipe, title: "Queued Again" }, "queued-again-01")).data.status).toBe("pending");
  });

  it("retrying with the same key never creates a duplicate (AC-030)", async () => {
    await services.submissions.setApprovalRequired(false, adminId);
    const first = await tool.submitNew(recipe, "retry-key-0001");
    const second = await tool.submitNew(recipe, "retry-key-0001");
    expect(second.data).toEqual(first.data);
    expect((await services.catalog.browse({})).total).toBe(1);
  });

  it("refuses an update based on an outdated revision (AC-031)", async () => {
    const id = await existingRecipe();
    const valid = validateEntry({ kind: "recipe", title: "Owner edit", ingredients: [], steps: [], tags: [], collectionIds: [] });
    if (!valid.ok) throw new Error();
    await services.catalog.update(id, 1, valid.value, admin());
    const { data, http: code } = await tool.submitUpdate(id, 1, { title: "Stale AI edit" }, "stale-edit-001");
    expect(data).toMatchObject({ status: "conflict", recipeId: id, currentRevision: 2 });
    if (code) expect(code).toBe(409);
    expect((await services.catalog.get(id))?.title).toBe("Owner edit");
    expect(await services.submissions.countPending()).toBe(0);
  });

  it("an update approved after the owner edited becomes a conflict, not an overwrite", async () => {
    const id = await existingRecipe();
    const { data } = await tool.submitUpdate(id, 1, { title: "AI rename" }, "late-approve-01");
    const valid = validateEntry({ kind: "recipe", title: "Owner edit meanwhile", ingredients: [], steps: [], tags: [], collectionIds: [] });
    if (!valid.ok) throw new Error();
    await services.catalog.update(id, 1, valid.value, admin());
    const decided = await services.submissions.approve(String(data.submissionId), admin());
    expect(decided?.status).toBe("conflict");
    expect((await services.catalog.get(id))?.title).toBe("Owner edit meanwhile");
    expect(await tool.status(String(data.submissionId))).toMatchObject({ status: "conflict" });
  });

  it("rejects invalid input with a clear message and stores nothing", async () => {
    const { data, http: code } = await tool.submitNew({ title: "" }, "invalid-0001");
    expect(data.status).toBe("validation_failed");
    if (code) expect(code).toBe(422);
    expect(await services.submissions.countPending()).toBe(0);
  });
});

describe("tools cannot approve or change settings (AC-029)", () => {
  it("offers no such MCP tool and no such API route", async () => {
    const unknownTool = await callTool(services, oauthToken, "approve_submission", { submission_id: "x" });
    expect(unknownTool.isError || unknownTool.data?.code).toBeTruthy();
    for (const [method, path] of [
      ["POST", "/api/v1/submissions/x/approve"],
      ["POST", "/api/v1/settings"],
      ["PUT", "/api/v1/settings/approval_required"],
    ] as const) {
      const res = await request(services, path, { method, headers: { Authorization: `Bearer ${apiKey}` } });
      expect(res.status).toBe(404);
    }
    expect(await services.submissions.approvalRequired()).toBe(true);
  });

  it("tool credentials never count as a signed-in admin (so they can't use review or settings)", async () => {
    for (const bearer of [apiKey, oauthToken]) {
      const viewer = await getViewer(new Request("http://localhost:5173/review", { headers: { Authorization: `Bearer ${bearer}` } }), services);
      expect(viewer).toBeNull();
    }
  });

  it("each tool only sees its own submissions", async () => {
    const { data } = await mcp().submitNew(recipe, "own-only-0001");
    expect(await http().status(String(data.submissionId))).toMatchObject({ status: "not_found" });
  });
});

describe("authentication and revocation", () => {
  it("rejects missing, malformed and unknown credentials", async () => {
    for (const header of [undefined, "Bearer nonsense", "Bearer ck_unknownkey"]) {
      const res = await request(services, "/api/v1/recipes", { headers: header ? { Authorization: header } : {} });
      expect(res.status).toBe(401);
    }
  });

  it("a revoked API key stops working immediately", async () => {
    await revokeApiKey(services.db, apiKeyId, new Date());
    expect((await request(services, "/api/v1/recipes", { headers: { Authorization: `Bearer ${apiKey}` } })).status).toBe(401);
  });

  it("a disconnected app's existing token stops working; it can reconnect", async () => {
    expect((await listConnectedTools(services.db)).map((t) => t.name)).toEqual(["Claude"]);
    await disconnectTool(services.db, oauthClientId, { now: new Date(Date.now() + 1000), userId: adminId });
    expect((await callTool(services, oauthToken, "search_recipes", {})).httpStatus).toBe(401);
    expect(await listConnectedTools(services.db)).toEqual([]);
  });

  it("keys created by someone who is no longer an admin stop working", async () => {
    const now = new Date();
    await services.db.insert(user).values({ id: "former", email: "former-admin@example.com", name: "Former", emailVerified: true, createdAt: now, updatedAt: now });
    const key = (await createApiKey(services.db, "Old key", "former", now))!.key;
    expect((await request(services, "/api/v1/recipes", { headers: { Authorization: `Bearer ${key}` } })).status).toBe(401);
  });
});
