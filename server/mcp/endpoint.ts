import { verifyJwsAccessToken } from "better-auth/oauth2";
import type { Auth } from "../auth/auth";
import { mcpResourceUrl } from "../auth/auth";
import type { AppConfig } from "../config";
import { createMcpRequestHandler } from "./server";

/** RFC 9728 path-inserted metadata URL for the /mcp resource. */
export function protectedResourceMetadataUrl(config: AppConfig): string {
  return `${config.baseUrl}/.well-known/oauth-protected-resource/mcp`;
}

function unauthorized(config: AppConfig, error?: { code: string; description: string }): Response {
  const params = [`resource_metadata="${protectedResourceMetadataUrl(config)}"`];
  if (error) params.push(`error="${error.code}"`, `error_description="${error.description}"`);
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: error?.description ?? "Authentication required" }, id: null },
    { status: 401, headers: { "WWW-Authenticate": `Bearer ${params.join(", ")}` } },
  );
}

/**
 * The /mcp endpoint: verifies the OAuth access token, then serves MCP.
 *
 * Equivalent to `requireMcpAuth` from @better-auth/mcp, except the signing
 * keys are read in-process (`auth.api.getJwks`). `requireMcpAuth` fetches
 * `<baseURL>/jwks` over HTTP, and a Cloudflare Worker cannot fetch its own
 * hostname. Only Bearer tokens are accepted (DPoP is not used by our clients).
 */
export function createMcpEndpoint(auth: Auth, config: AppConfig) {
  const mcp = createMcpRequestHandler();
  const resource = mcpResourceUrl(config);
  const jwksCacheKey = {};

  return async (request: Request): Promise<Response> => {
    const header = request.headers.get("authorization");
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match) return unauthorized(config);

    const { baseURL: issuer } = await auth.$context;
    let claims;
    try {
      claims = await verifyJwsAccessToken(match[1]!, {
        jwksFetch: async () => auth.api.getJwks(),
        jwksCacheKey,
        verifyOptions: { issuer, audience: resource, requiredClaims: ["azp"] },
      });
    } catch {
      return unauthorized(config, { code: "invalid_token", description: "The access token is invalid or expired" });
    }

    const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
    return mcp.fetch(request, {
      authInfo: {
        token: match[1]!,
        clientId: String(claims.azp),
        scopes,
        expiresAt: claims.exp,
        extra: { sub: claims.sub },
      },
    });
  };
}
