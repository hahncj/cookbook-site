import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createServices, handleRequest, type PageRenderer, type Services } from "../../server/app";
import { fetchClientMetadataViaFetch } from "../../server/auth/cimd-fetch";
import { loadConfig } from "../../server/config";
import * as schema from "../../server/db/schema";
import type { MediaStore } from "../../server/adapters/media";
import type { RecipeAi } from "../../server/core/ai";
import type { ImageFetcher, PageFetcher } from "../../server/importers/fetch-page";
import type { PhotoSearchProvider } from "../../server/core/photo-finder";

export const BASE_URL = "http://localhost:5173";
export const ADMIN_EMAIL = "admin@example.com";

export function createTestServices(
  options: {
    media?: MediaStore | null;
    ai?: RecipeAi;
    fetchPage?: PageFetcher;
    fetchImage?: ImageFetcher;
    photoStock?: PhotoSearchProvider | null;
    photoWeb?: PhotoSearchProvider | null;
    env?: Record<string, string>;
  } = {},
): Services {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "db/migrations" });
  const config = loadConfig(
    {
      PUBLIC_BASE_URL: BASE_URL,
      ADMIN_EMAILS: `${ADMIN_EMAIL}, Second.Admin@Example.com`,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      ...options.env,
    },
    "node",
  );
  return createServices({
    config,
    db,
    media: options.media ?? null,
    fetchClientMetadata: fetchClientMetadataViaFetch,
    ai: options.ai,
    // Tests never reach the network unless they supply a fetcher.
    fetchPage: options.fetchPage ?? (async () => ({ ok: false, message: "No network in tests." })),
    fetchImage: options.fetchImage ?? (async () => ({ ok: false, message: "No network in tests." })),
    // Real photo providers are never called in tests.
    photoStock: options.photoStock ?? null,
    photoWeb: options.photoWeb ?? null,
  });
}

/**
 * Inserts an admin user row directly, standing in for a completed Google
 * sign-in (the sign-in gate itself is tested separately via adminOnlyGate).
 */
export async function insertAdminUser(services: Services, email = ADMIN_EMAIL) {
  const id = crypto.randomUUID();
  const now = new Date();
  await services.db.insert(schema.user).values({ id, email, name: "Admin", emailVerified: true, createdAt: now, updatedAt: now });
  return { id, email };
}

export const pageStub: PageRenderer = async () => new Response("<html>page</html>", { headers: { "Content-Type": "text/html" } });

export function request(services: Services, path: string, init?: RequestInit) {
  return handleRequest(new Request(`${BASE_URL}${path}`, init), services, pageStub);
}

/** A signed session cookie for a new user with this email (stands in for Google sign-in). */
export async function sessionCookieFor(services: Services, email: string) {
  const { serializeSignedCookie } = await import("better-call");
  const ctx = await services.auth.$context;
  const id = crypto.randomUUID();
  const now = new Date();
  await services.db.insert(schema.user).values({ id, email, name: "Someone", emailVerified: true, createdAt: now, updatedAt: now });
  const session = await ctx.internalAdapter.createSession(id);
  return (await serializeSignedCookie("better-auth.session_token", session.token, ctx.secret)).split(";")[0]!;
}
