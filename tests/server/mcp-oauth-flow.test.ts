import { createHash, randomBytes } from "node:crypto";
import { serializeSignedCookie } from "better-call";
import { beforeEach, describe, expect, it } from "vitest";
import type { Services } from "../../server/app";
import { BASE_URL, createTestServices, insertAdminUser, request } from "../helpers/services";

// End-to-end connector flow without Google: an admin session is created
// directly (what Google sign-in produces), then an MCP client registers,
// authorizes with PKCE, consents, exchanges the code, and calls a tool.

const REDIRECT_URI = "http://127.0.0.1:9999/callback";
const base64url = (buf: Buffer) => buf.toString("base64url");

let services: Services;
let cookie: string;

beforeEach(async () => {
  services = createTestServices();
  const ctx = await services.auth.$context;
  const user = await insertAdminUser(services);
  const session = await ctx.internalAdapter.createSession(user.id);
  const signed = await serializeSignedCookie("better-auth.session_token", session.token, ctx.secret);
  cookie = signed.split(";")[0]!;
});

async function registerClient() {
  const res = await request(services, "/api/auth/oauth2/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test Connector",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(res.status).toBeLessThan(300);
  return ((await res.json()) as { client_id: string }).client_id;
}

async function obtainToken(options: { resource?: string } = {}) {
  const clientId = await registerClient();
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const authorizeParams = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile offline_access",
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (options.resource) authorizeParams.set("resource", options.resource);

  // 1. Authorize: a signed-in admin is sent to the consent page.
  const authorize = await request(services, `/api/auth/oauth2/authorize?${authorizeParams}`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  expect(authorize.status).toBe(302);
  const consentUrl = new URL(authorize.headers.get("Location")!, BASE_URL);
  expect(consentUrl.pathname).toBe("/consent");

  // 2. Consent: the page posts the signed query and receives the redirect.
  const consent = await request(services, "/api/auth/oauth2/consent", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
  });
  expect(consent.status).toBe(200);
  const { url } = (await consent.json()) as { url: string };
  const callback = new URL(url);
  expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
  expect(callback.searchParams.get("state")).toBe("xyz");
  const code = callback.searchParams.get("code")!;

  // 3. Token exchange with the PKCE verifier.
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (options.resource) tokenBody.set("resource", options.resource);
  const token = await request(services, "/api/auth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  expect(token.status).toBe(200);
  return ((await token.json()) as { access_token: string }).access_token;
}

function callPing(accessToken: string) {
  return request(services, "/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ping", arguments: {} } }),
  });
}

describe("MCP connector OAuth flow (D1)", () => {
  it("issues an access token for /mcp that the MCP endpoint accepts", async () => {
    const accessToken = await obtainToken({ resource: `${BASE_URL}/mcp` });
    const res = await callPing(accessToken);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"text":"pong"');
  });

  it("rejects a token issued for a different audience", async () => {
    const accessToken = await obtainToken();
    const res = await callPing(accessToken);
    expect(res.status).toBe(401);
  });
});
