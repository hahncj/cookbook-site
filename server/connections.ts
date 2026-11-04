import { desc, eq, max } from "drizzle-orm";
import type { Database } from "./adapters/db";
import { atomic } from "./adapters/atomic";
import { oauthClient, oauthConsent, oauthRefreshToken } from "./db/auth-schema";
import { toolRevocations } from "./db/app-schema";

export interface ConnectedTool {
  clientId: string;
  name: string;
  domain: string | null;
  connectedAt: Date | null;
}

function hostOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** AI apps an admin has approved through the consent screen (ChatGPT, Claude.ai, …). */
export async function listConnectedTools(db: Database): Promise<ConnectedTool[]> {
  const rows = await db
    .select({
      clientId: oauthConsent.clientId,
      name: oauthClient.name,
      uri: oauthClient.uri,
      redirectUris: oauthClient.redirectUris,
      connectedAt: max(oauthConsent.createdAt),
    })
    .from(oauthConsent)
    .leftJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .groupBy(oauthConsent.clientId, oauthClient.name, oauthClient.uri, oauthClient.redirectUris)
    .orderBy(desc(max(oauthConsent.createdAt)));
  return rows.map((row) => {
    const redirects = typeof row.redirectUris === "string" ? JSON.parse(row.redirectUris) : row.redirectUris;
    return {
      clientId: row.clientId,
      name: row.name?.trim() || "An AI tool",
      domain: hostOf(row.clientId) ?? (Array.isArray(redirects) ? hostOf(redirects[0]) : null) ?? hostOf(row.uri),
      connectedAt: row.connectedAt ? new Date(row.connectedAt as unknown as number) : null,
    };
  });
}

/**
 * Disconnects an AI app: removes its consent, revokes its refresh tokens, and
 * refuses access tokens issued before now. The app can be connected again
 * later through the normal consent screen.
 */
export async function disconnectTool(db: Database, clientId: string, meta: { now: Date; userId: string }) {
  await atomic(db, [
    () => db.delete(oauthConsent).where(eq(oauthConsent.clientId, clientId)),
    () => db.update(oauthRefreshToken).set({ revoked: meta.now }).where(eq(oauthRefreshToken.clientId, clientId)),
    () =>
      db
        .insert(toolRevocations)
        .values({ clientId, revokedAt: meta.now, revokedBy: meta.userId })
        .onConflictDoUpdate({ target: toolRevocations.clientId, set: { revokedAt: meta.now, revokedBy: meta.userId } }),
  ]);
}
