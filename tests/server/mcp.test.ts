import { beforeEach, describe, expect, it } from "vitest";
import type { Services } from "../../server/app";
import { createApiKey } from "../../server/api-keys";
import { createTestServices, insertAdminUser, request } from "../helpers/services";

let services: Services;
let key: string;

beforeEach(async () => {
  services = createTestServices();
  const admin = await insertAdminUser(services);
  key = (await createApiKey(services.db, "Tests", admin.id, new Date()))!.key;
});

async function rpc(method: string, params: unknown, id = 1) {
  const res = await request(services, "/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  if (!res.headers.get("Content-Type")?.includes("text/event-stream")) return JSON.parse(text);
  return text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))).find((m) => m.id === id);
}

describe("MCP server (2025 protocol, stateless)", () => {
  it("initializes with instructions for the AI", async () => {
    const body = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(body.result.serverInfo.name).toBe("cookbook");
    expect(body.result.instructions).toMatch(/Never invent missing quantities/);
  });

  it("lists the cookbook tools with read-only hints where appropriate", async () => {
    const list = await rpc("tools/list", {});
    const tools = Object.fromEntries(list.result.tools.map((t: { name: string; annotations?: { readOnlyHint?: boolean } }) => [t.name, t.annotations?.readOnlyHint]));
    expect(tools).toEqual({
      search_recipes: true,
      get_recipe: true,
      submit_recipe: false,
      update_recipe: false,
      get_submission_status: true,
    });
  });
});
