import { eq } from "drizzle-orm";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import type { Services } from "./app";
import { verifyApiKey } from "./api-keys";
import { mcpResourceUrl } from "./auth/auth";
import { isAdminEmail } from "./core/admin";
import type { Submitter } from "./core/submissions";
import { oauthClient, user } from "./db/auth-schema";
import { toolRevocations } from "./db/app-schema";

export type ToolAuth = { ok: true; submitter: Submitter } | { ok: false; reason: "missing" | "invalid" };

async function isAdminUser(services: Services, userId: string) {
  const [row] = await services.db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
  return isAdminEmail(row?.email, services.config.adminEmails);
}

/**
 * Authenticates an AI tool calling /mcp or /api/v1. Accepts either an OAuth
 * access token issued to a connected app (ChatGPT, Claude.ai) or a personal
 * API key (`ck_…`). In both cases the tool acts for an admin, and the admin
 * allow-list is re-checked on every call, so removing an admin also cuts off
 * their tools. Disconnected OAuth apps' older tokens are refused.
 */
export async function authenticateTool(request: Request, services: Services): Promise<ToolAuth> {
  const header = request.headers.get("authorization");
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { ok: false, reason: "missing" };
  const now = new Date();

  if (token.startsWith("ck_")) {
    const key = await verifyApiKey(services.db, token, now);
    if (!key || !(await isAdminUser(services, key.createdBy))) return { ok: false, reason: "invalid" };
    return {
      ok: true,
      submitter: { credentialKind: "api_key", credentialId: key.id, clientName: `API key “${key.name}”`, userId: key.createdBy },
    };
  }

  let claims;
  try {
    const { baseURL: issuer } = await services.auth.$context;
    claims = await verifyJwsAccessToken(token, {
      jwksFetch: async () => services.auth.api.getJwks(),
      // Cache keyed to this request's auth instance: signing keys are read from
      // this cookbook's own database, never shared across instances.
      jwksCacheKey: services.auth,
      verifyOptions: { issuer, audience: mcpResourceUrl(services.config), requiredClaims: ["azp", "sub", "iat"] },
    });
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const clientId = String(claims.azp);
  const userId = String(claims.sub);
  const [[revocation], [client]] = await Promise.all([
    services.db.select({ revokedAt: toolRevocations.revokedAt }).from(toolRevocations).where(eq(toolRevocations.clientId, clientId)).limit(1),
    services.db.select({ name: oauthClient.name, disabled: oauthClient.disabled }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1),
  ]);
  if (client?.disabled) return { ok: false, reason: "invalid" };
  if (revocation && (claims.iat ?? 0) * 1000 <= revocation.revokedAt.getTime()) return { ok: false, reason: "invalid" };
  if (!(await isAdminUser(services, userId))) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    submitter: { credentialKind: "oauth", credentialId: clientId, clientName: client?.name?.trim() || "An AI tool", userId },
  };
}
