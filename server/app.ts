import { sql } from "drizzle-orm";
import type { Database } from "./adapters/db";
import type { MediaStore } from "./adapters/media";
import type { AppConfig } from "./config";
import type { Auth } from "./auth/auth";
import { AUTH_BASE_PATH, MCP_PATH, createAuth } from "./auth/auth";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { createMcpEndpoint } from "./mcp/endpoint";
import { createCatalogRepository } from "./adapters/catalog-repo";
import { createCatalog, type Catalog } from "./core/catalog";
import { isAdminEmail } from "./core/admin";
import { servePhoto } from "./photos";

/** Everything a request handler may use. Built per request by the host adapter. */
export interface Services {
  config: AppConfig;
  db: Database;
  auth: Auth;
  /** Absent when the host has no media storage configured yet. */
  media: MediaStore | null;
  catalog: Catalog;
}

export interface HostDeps {
  config: AppConfig;
  db: Database;
  media: MediaStore | null;
  fetchClientMetadata: ClientMetadataResourceFetch;
}

export function createServices(deps: HostDeps): Services {
  const newId = () => crypto.randomUUID();
  return {
    config: deps.config,
    db: deps.db,
    media: deps.media,
    auth: createAuth({ config: deps.config, db: deps.db, fetchClientMetadata: deps.fetchClientMetadata }),
    catalog: createCatalog({ repo: createCatalogRepository(deps.db, newId), now: () => new Date(), newId }),
  };
}

/** Renders UI routes (React Router); supplied by each host. */
export type PageRenderer = (request: Request, services: Services) => Promise<Response>;

const NOINDEX = "noindex, nofollow"; // D10

async function health(services: Services): Promise<Response> {
  const checks: Record<string, string> = {};
  let ok = true;
  try {
    await services.db.run(sql`select count(*) from user`);
    checks.database = "ok";
  } catch (error) {
    ok = false;
    checks.database = `error: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (services.media) {
    try {
      await services.media.ping();
      checks.media = "ok";
    } catch (error) {
      ok = false;
      checks.media = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    checks.media = "not configured";
  }
  return Response.json({ ok, host: services.config.host, checks }, { status: ok ? 200 : 503 });
}

export async function handleRequest(request: Request, services: Services, renderPage: PageRenderer) {
  const { pathname } = new URL(request.url);
  let response: Response;

  if (pathname === "/health") {
    response = await health(services);
  } else if (pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`) || pathname.startsWith("/.well-known/")) {
    // Better Auth serves OAuth/OIDC discovery and protected-resource metadata.
    response = await services.auth.handler(request);
  } else if (pathname === MCP_PATH) {
    response = await createMcpEndpoint(services.auth, services.config)(request);
  } else if (pathname.startsWith("/media/") && (request.method === "GET" || request.method === "HEAD")) {
    response = await servePhoto(request, {
      db: services.db,
      media: services.media,
      isAdmin: async () => {
        const session = await services.auth.api.getSession({ headers: request.headers });
        return isAdminEmail(session?.user.email, services.config.adminEmails);
      },
    });
  } else {
    response = await renderPage(request, services);
  }

  // Responses from fetch() can have immutable headers; copy before setting.
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", NOINDEX);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
