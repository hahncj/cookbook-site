import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import type { AppConfig } from "../config";
import type { Database } from "../adapters/db";
import { isAdminEmail } from "../core/admin";
import * as schema from "../db/schema";

export const AUTH_BASE_PATH = "/api/auth";
export const MCP_PATH = "/mcp";

export interface AuthDeps {
  config: AppConfig;
  db: Database;
  /** Host-specific CIMD transport (Node: DNS-pinned; Workers: plain fetch). */
  fetchClientMetadata: ClientMetadataResourceFetch;
}

export function mcpResourceUrl(config: AppConfig): string {
  return `${config.baseUrl}${MCP_PATH}`;
}

/**
 * D5 sign-in gate. Better Auth calls it before creating a user and on every
 * Google sign-in (with the fresh Google email), so only configured admins can
 * ever sign in, and removing an email locks it out at the next sign-in. Page
 * and API authorization also re-check the list on every request.
 */
export function adminOnlyGate(adminEmails: readonly string[]) {
  return ({ user }: { user: { email?: unknown } }) =>
    isAdminEmail(typeof user.email === "string" ? user.email : null, adminEmails)
      ? undefined
      : { error: "not_admin", errorDescription: "Only cookbook admin accounts can sign in." };
}

export function createAuth({ config, db, fetchClientMetadata }: AuthDeps) {
  return betterAuth({
    baseURL: config.baseUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.authSecret,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        // Refresh name and profile picture from Google on every sign-in (E2),
        // so the top-bar avatar stays current. Better Auth stores it as user.image.
        overrideUserInfoOnSignIn: true,
      },
    },
    // The JWT plugin's session-to-JWT endpoint is not needed and is disabled
    // as the OAuth provider docs recommend.
    disabledPaths: ["/token"],
    advanced: { ipAddress: { ipAddressHeaders: config.clientIpHeaders } },
    user: { validateUserInfo: adminOnlyGate(config.adminEmails) },
    plugins: [
      jwt(),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource: mcpResourceUrl(config),
        // D1: ChatGPT and Claude.ai. CIMD is the current MCP mechanism;
        // dynamic client registration stays on for clients that still use it.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
      }),
      cimd({
        fetchClientMetadataResource: fetchClientMetadata,
        metadataProfile: "mcp-2026-07-28",
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
