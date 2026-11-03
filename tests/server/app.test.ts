import { beforeEach, describe, expect, it } from "vitest";
import type { Services } from "../../server/app";
import { adminOnlyGate } from "../../server/auth/auth";
import { loadConfig } from "../../server/config";
import { parseAdminEmails } from "../../server/core/admin";
import { ADMIN_EMAIL, BASE_URL, createTestServices, request } from "../helpers/services";

let services: Services;
beforeEach(() => {
  services = createTestServices();
});

describe("configuration", () => {
  it("rejects missing or weak settings with a readable message", () => {
    expect(() => loadConfig({ PUBLIC_BASE_URL: "not a url" }, "node")).toThrow(/Invalid configuration/);
    expect(() =>
      loadConfig(
        { PUBLIC_BASE_URL: BASE_URL, ADMIN_EMAILS: "a@b.c", BETTER_AUTH_SECRET: "short", GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x" },
        "node",
      ),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });
});

describe("routing", () => {
  it("reports database health", async () => {
    const res = await request(services, "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, host: "node", checks: { database: "ok", media: "not configured" } });
  });

  it("marks every response noindex (D10)", async () => {
    for (const path of ["/", "/health", "/mcp"]) {
      const res = await request(services, path, { method: path === "/mcp" ? "POST" : "GET" });
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    }
  });

  it("passes other paths to the page renderer", async () => {
    const res = await request(services, "/anything");
    expect(await res.text()).toContain("page");
  });
});

type Json = Record<string, unknown>;

describe("admin-only sign-in gate (D5, AC-063)", () => {
  const gate = adminOnlyGate(parseAdminEmails(`${ADMIN_EMAIL}, Second.Admin@Example.com`));

  it("rejects Google accounts not on the allow-list", () => {
    expect(gate({ user: { email: "intruder@example.com" } })).toEqual({
      error: "not_admin",
      errorDescription: "Only cookbook admin accounts can sign in.",
    });
    expect(gate({ user: {} })).toMatchObject({ error: "not_admin" });
  });

  it("admits configured admins, case-insensitively", () => {
    expect(gate({ user: { email: ADMIN_EMAIL } })).toBeUndefined();
    expect(gate({ user: { email: "SECOND.admin@example.com" } })).toBeUndefined();
  });

  it("is the gate the auth instance is configured with", () => {
    const validate = services.auth.options.user?.validateUserInfo;
    expect(typeof validate).toBe("function");
  });
});

describe("MCP OAuth discovery (D1)", () => {
  it("challenges unauthenticated MCP requests with RFC 9728 metadata", async () => {
    const res = await request(services, "/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("rejects invalid access tokens", async () => {
    const res = await request(services, "/mcp", { method: "POST", body: "{}", headers: { Authorization: "Bearer not-a-jwt" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });

  it("serves protected-resource metadata for /mcp", async () => {
    const res = await request(services, "/.well-known/oauth-protected-resource/mcp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.resource).toBe(`${BASE_URL}/mcp`);
    expect(body.authorization_servers).toEqual([`${BASE_URL}/api/auth`]);
  });

  it("serves authorization-server metadata with CIMD, DCR, and PKCE S256", async () => {
    const res = await request(services, "/.well-known/oauth-authorization-server/api/auth");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.issuer).toBe(`${BASE_URL}/api/auth`);
    expect(body.client_id_metadata_document_supported).toBe(true);
    expect(body.registration_endpoint).toBe(`${BASE_URL}/api/auth/oauth2/register`);
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
  });
});
