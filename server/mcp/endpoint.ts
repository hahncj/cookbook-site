import type { Services } from "../app";
import type { AppConfig } from "../config";
import { authenticateTool } from "../tool-auth";
import { createMcpRequestHandler } from "./server";

/** RFC 9728 path-inserted metadata URL for the /mcp resource. */
export function protectedResourceMetadataUrl(config: AppConfig): string {
  return `${config.baseUrl}/.well-known/oauth-protected-resource/mcp`;
}

function unauthorized(config: AppConfig, invalid: boolean): Response {
  const params = [`resource_metadata="${protectedResourceMetadataUrl(config)}"`];
  if (invalid) params.push(`error="invalid_token"`, `error_description="The access token is invalid, expired, or revoked"`);
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: invalid ? "The access token is invalid, expired, or revoked" : "Authentication required" }, id: null },
    { status: 401, headers: { "WWW-Authenticate": `Bearer ${params.join(", ")}` } },
  );
}

/**
 * The /mcp endpoint. Accepts OAuth access tokens from connected apps and
 * personal API keys (see server/tool-auth.ts). Signing keys are read
 * in-process because a Cloudflare Worker cannot fetch its own hostname.
 */
export async function handleMcp(request: Request, services: Services): Promise<Response> {
  const auth = await authenticateTool(request, services);
  if (!auth.ok) return unauthorized(services.config, auth.reason === "invalid");
  const scopes: string[] = [];
  return createMcpRequestHandler(services, auth.submitter).fetch(request, {
    authInfo: {
      token: "",
      clientId: auth.submitter.credentialId,
      scopes,
      extra: { userId: auth.submitter.userId, credentialKind: auth.submitter.credentialKind },
    },
  });
}
