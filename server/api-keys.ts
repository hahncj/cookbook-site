import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "./adapters/db";
import { atomic } from "./adapters/atomic";
import { apiKeys } from "./db/app-schema";

/**
 * Personal API keys for AI tools that don't do OAuth (scripts, Claude Code,
 * other agents). Keys look like `ck_<43 chars>`, are shown once, and only a
 * SHA-256 hash is stored. They can read the catalog and submit recipes for
 * review; they can never approve submissions or change settings.
 */
export const API_KEY_PREFIX = "ck_";

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return base64url(new Uint8Array(digest));
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Creates a key and returns it once. Only its hash is stored. */
export async function createApiKey(db: Database, name: string, userId: string, now: Date) {
  const trimmed = name.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!trimmed) return null;
  const key = API_KEY_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
  const id = crypto.randomUUID();
  const keyHash = await hashApiKey(key);
  await atomic(db, [
    () => db.insert(apiKeys).values({ id, name: trimmed, prefix: key.slice(0, 10), keyHash, createdAt: now, createdBy: userId }),
  ]);
  return { id, key, name: trimmed };
}

export async function listApiKeys(db: Database): Promise<ApiKeyInfo[]> {
  return db
    .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(db: Database, id: string, now: Date) {
  await atomic(db, [() => db.update(apiKeys).set({ revokedAt: now }).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))]);
}

/** Finds an active key. Records use at most once an hour, to keep writes rare. */
export async function verifyApiKey(db: Database, key: string, now: Date) {
  if (!key.startsWith(API_KEY_PREFIX) || key.length > 100) return null;
  const keyHash = await hashApiKey(key);
  const [row] = await db
    .select({ id: apiKeys.id, name: apiKeys.name, createdBy: apiKeys.createdBy, lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 3_600_000) {
    await atomic(db, [() => db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id))]);
  }
  return row;
}
