import { beforeEach, describe, expect, it } from "vitest";
import { createRouterContext } from "../../app/context";
import { loader as rootLoader } from "../../app/root";
import { action as reviewAction, loader as reviewLoader } from "../../app/routes/review";
import { action as settingsAction, loader as settingsLoader } from "../../app/routes/settings";
import type { Services } from "../../server/app";
import { ADMIN_EMAIL, BASE_URL, createTestServices, request, sessionCookieFor } from "../helpers/services";

let services: Services;
let admin: string;

beforeEach(async () => {
  services = createTestServices();
  admin = await sessionCookieFor(services, ADMIN_EMAIL);
});

const args = (req: Request) => ({ request: req, params: {}, context: createRouterContext(services) }) as never;
const post = (path: string, fields: Record<string, string>, cookie?: string) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request(`${BASE_URL}${path}`, { method: "POST", body, headers: cookie ? { Cookie: cookie } : {} });
};
const get = (path: string, cookie?: string) => new Request(`${BASE_URL}${path}`, { headers: cookie ? { Cookie: cookie } : {} });

async function status(promise: Promise<unknown>) {
  try {
    const r = await promise;
    return r instanceof Response ? r.status : 200;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    throw thrown;
  }
}

async function createKeyViaPage(name = "Script") {
  const result = (await settingsAction(args(post("/settings", { intent: "create-key", name }, admin))))! as { newKey?: string };
  return result.newKey!;
}

async function submitViaApi(key: string, title: string, idem: string) {
  const res = await request(services, "/api/v1/recipes", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idem },
    body: JSON.stringify({ recipe: { title, ingredients: [{ quantity: "1", item: "lemon" }] }, note: "From a chat" }),
  });
  return (await res.json()) as { submissionId: string; status: string };
}

describe("review and settings are admin-only (AC-029, AC-064)", () => {
  it("rejects signed-out and non-admin requests", async () => {
    const someone = await sessionCookieFor(services, "someone@example.com");
    expect(await status(reviewLoader(args(get("/review"))))).toBe(302);
    expect(await status(settingsLoader(args(get("/settings"))))).toBe(302);
    for (const [cookie, code] of [[undefined, 401], [someone, 403]] as const) {
      expect(await status(reviewAction(args(post("/review", { intent: "approve", id: "x" }, cookie))))).toBe(code);
      expect(await status(settingsAction(args(post("/settings", { intent: "approval", required: "false" }, cookie))))).toBe(code);
      expect(await status(settingsAction(args(post("/settings", { intent: "create-key", name: "x" }, cookie))))).toBe(code);
    }
    expect(await services.submissions.approvalRequired()).toBe(true);
  });
});

describe("admin pages", () => {
  it("creates an API key that works once, shows it once, and revokes it", async () => {
    const key = await createKeyViaPage("Claude Code");
    expect(key).toMatch(/^ck_[A-Za-z0-9_-]{43}$/);
    const page = await settingsLoader(args(get("/settings", admin)));
    expect(page.keys).toEqual([expect.objectContaining({ name: "Claude Code", prefix: key.slice(0, 10) })]);
    expect(JSON.stringify(page)).not.toContain(key); // never shown again
    expect((await request(services, "/api/v1/recipes", { headers: { Authorization: `Bearer ${key}` } })).status).toBe(200);
    await settingsAction(args(post("/settings", { intent: "revoke-key", id: page.keys[0]!.id }, admin)));
    expect((await request(services, "/api/v1/recipes", { headers: { Authorization: `Bearer ${key}` } })).status).toBe(401);
  });

  it("shows waiting submissions to admins only, and approves or rejects them", async () => {
    const key = await createKeyViaPage();
    const a = await submitViaApi(key, "Lemon Bars", "lemon-bars-0001");
    const b = await submitViaApi(key, "Lemon Curd", "lemon-curd-0001");
    expect((await rootLoader(args(get("/", admin)))).pendingReviews).toBe(2);
    expect((await rootLoader(args(get("/")))).pendingReviews).toBe(0); // not exposed publicly (AC-070)

    const queue = await reviewLoader(args(get("/review", admin)));
    expect(queue.pending.map((p) => [p.title, p.clientName, p.note])).toEqual([
      ["Lemon Curd", "API key “Script”", "From a chat"],
      ["Lemon Bars", "API key “Script”", "From a chat"],
    ]);

    await reviewAction(args(post("/review", { intent: "approve", id: a.submissionId }, admin)));
    await reviewAction(args(post("/review", { intent: "reject", id: b.submissionId }, admin)));
    const after = await reviewLoader(args(get("/review", admin)));
    expect(after.pending).toEqual([]);
    expect(after.decided.map((d) => [d.title, d.status])).toEqual([
      ["Lemon Curd", "rejected"],
      ["Lemon Bars", "applied"],
    ]);
    expect((await services.catalog.browse({})).items.map((i) => i.title)).toEqual(["Lemon Bars"]);
  });

  it("toggles approval", async () => {
    await settingsAction(args(post("/settings", { intent: "approval", required: "false" }, admin)));
    expect(await services.submissions.approvalRequired()).toBe(false);
    const key = await createKeyViaPage();
    expect((await submitViaApi(key, "Instant Pickles", "pickles-00001")).status).toBe("applied");
    await settingsAction(args(post("/settings", { intent: "approval", required: "true" }, admin)));
    expect(await services.submissions.approvalRequired()).toBe(true);
  });
});
