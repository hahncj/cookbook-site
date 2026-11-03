import { describe, expect, it } from "vitest";
import { createMcpRequestHandler } from "../../server/mcp/server";

const handler = createMcpRequestHandler();

/** Sends one JSON-RPC request and returns the JSON-RPC response, whether sent as JSON or SSE. */
async function rpc(method: string, params: unknown, id = 1) {
  const res = await handler.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
  );
  expect(res.status).toBe(200);
  const text = await res.text();
  if (!res.headers.get("Content-Type")?.includes("text/event-stream")) return JSON.parse(text);
  const data = text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  return data.find((message) => message.id === id);
}

describe("MCP server (2025 protocol, stateless)", () => {
  it("initializes", async () => {
    const body = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(body.result.serverInfo.name).toBe("cookbook");
  });

  it("lists and calls the ping tool", async () => {
    const list = await rpc("tools/list", {});
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("ping");
    const call = await rpc("tools/call", { name: "ping", arguments: {} }, 2);
    expect(call.result.content).toEqual([{ type: "text", text: "pong" }]);
  });
});
