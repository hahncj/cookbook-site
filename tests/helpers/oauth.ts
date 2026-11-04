import { createHash, randomBytes } from "node:crypto";
import { expect } from "vitest";
import type { Services } from "../../server/app";
import { BASE_URL, request, sessionCookieFor } from "./services";

// End-to-end connector OAuth without Google: an admin session stands in for
// Google sign-in, then a client registers, authorizes with PKCE, consents and
// exchanges the code — exactly what ChatGPT/Claude.ai do.

const REDIRECT_URI = "http://127.0.0.1:9999/callback";
const base64url = (buf: Buffer) => buf.toString("base64url");

export async function connectTool(services: Services, options: { email: string; clientName?: string; resource?: string | null }) {
  const cookie = await sessionCookieFor(services, options.email);
  const registered = await request(services, "/api/auth/oauth2/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: options.clientName ?? "Test Connector",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(registered.status).toBeLessThan(300);
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  const resource = options.resource === undefined ? `${BASE_URL}/mcp` : options.resource;

  const verifier = base64url(randomBytes(32));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile offline_access",
    state: "xyz",
    code_challenge: base64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  });
  if (resource) params.set("resource", resource);
  const authorize = await request(services, `/api/auth/oauth2/authorize?${params}`, { headers: { Cookie: cookie }, redirect: "manual" });
  expect(authorize.status).toBe(302);
  const consentUrl = new URL(authorize.headers.get("Location")!, BASE_URL);
  expect(consentUrl.pathname).toBe("/consent");
  const consent = await request(services, "/api/auth/oauth2/consent", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
  });
  expect(consent.status).toBe(200);
  const callback = new URL(((await consent.json()) as { url: string }).url);
  expect(callback.searchParams.get("state")).toBe("xyz");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: callback.searchParams.get("code")!,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (resource) body.set("resource", resource);
  const token = await request(services, "/api/auth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  expect(token.status).toBe(200);
  return { clientId, accessToken: ((await token.json()) as { access_token: string }).access_token, cookie };
}

/** Calls an MCP tool over HTTP (2025 protocol, stateless) and returns its parsed JSON result. */
export async function callTool(services: Services, bearer: string, name: string, args: Record<string, unknown>) {
  const res = await request(services, "/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  if (res.status !== 200) return { httpStatus: res.status, body: text };
  const message = res.headers.get("Content-Type")?.includes("text/event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))).find((m) => m.id === 1)
    : JSON.parse(text);
  const result = message.result;
  return { httpStatus: 200, isError: Boolean(result?.isError), data: result ? JSON.parse(result.content[0].text) : message.error };
}
