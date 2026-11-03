import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";

export const MCP_SERVER_INFO = { name: "cookbook", version: "0.1.0" } as const;

/**
 * Builds the MCP server for one request (stateless serving). M0 exposes only
 * a `ping` tool to prove that connectors can authenticate and call tools;
 * recipe tools arrive in M4.
 */
export function createCookbookMcpServer(): McpServer {
  const server = new McpServer(MCP_SERVER_INFO);
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Connectivity check for the cookbook connector. Returns 'pong'.",
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );
  return server;
}

/**
 * Web-standard MCP handler. `legacy: "stateless"` keeps 2025-era clients
 * working alongside the 2026-07-28 protocol. 2025-era responses arrive as a
 * short SSE stream that closes after the result (allowed by the spec).
 */
export function createMcpRequestHandler() {
  return createMcpHandler(() => createCookbookMcpServer(), { legacy: "stateless" });
}
