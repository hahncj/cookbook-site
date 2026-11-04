import { sql } from "drizzle-orm";
import type { Database } from "./adapters/db";
import type { MediaStore } from "./adapters/media";
import type { AppConfig } from "./config";
import type { Auth } from "./auth/auth";
import { AUTH_BASE_PATH, MCP_PATH, createAuth } from "./auth/auth";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { handleMcp } from "./mcp/endpoint";
import { handleApiV1 } from "./api-v1";
import { createSubmissionsRepository } from "./adapters/submissions-repo";
import { createSubmissions, type Submissions } from "./core/submissions";
import { createCatalogRepository } from "./adapters/catalog-repo";
import { createCatalog, type Catalog } from "./core/catalog";
import { isAdminEmail } from "./core/admin";
import { servePhoto } from "./photos";
import { notConfigured, type RecipeAi } from "./core/ai";
import { createAnthropicAi } from "./ai/anthropic";
import { createImageFetcher, createPageFetcher, type ImageFetcher, type PageFetcher } from "./importers/fetch-page";
import { createPhotoFinder, type PhotoFinder, type PhotoSearchProvider } from "./core/photo-finder";
import { createBraveImageSearch, createPexelsSearch } from "./importers/photo-search";

/** Everything a request handler may use. Built per request by the host adapter. */
export interface Services {
  config: AppConfig;
  db: Database;
  auth: Auth;
  /** Absent when the host has no media storage configured yet. */
  media: MediaStore | null;
  catalog: Catalog;
  submissions: Submissions;
  /** In-app AI (admin-only). A stub that reports "not set up" when there's no key. */
  ai: RecipeAi;
  /** Fetches web pages for link import, with SSRF protection. */
  fetchPage: PageFetcher;
  /** Find a photo (E1): source page, stock, then web. Admin-only callers. */
  photoFinder: PhotoFinder;
  /** Downloads a chosen photo, with the same SSRF protection as fetchPage. */
  fetchImage: ImageFetcher;
}

export interface HostDeps {
  config: AppConfig;
  db: Database;
  media: MediaStore | null;
  fetchClientMetadata: ClientMetadataResourceFetch;
  /** Tests inject fakes. */
  ai?: RecipeAi;
  fetchPage?: PageFetcher;
  fetchImage?: ImageFetcher;
  /** Fakes for the stock and web photo searches; null turns one off. */
  photoStock?: PhotoSearchProvider | null;
  photoWeb?: PhotoSearchProvider | null;
}

export function createServices(deps: HostDeps): Services {
  const newId = () => crypto.randomUUID();
  const now = () => new Date();
  const catalog = createCatalog({ repo: createCatalogRepository(deps.db, newId), now, newId });
  const fetchPage = deps.fetchPage ?? createPageFetcher();
  const { pexels, brave } = deps.config.photoSearch;
  return {
    config: deps.config,
    db: deps.db,
    media: deps.media,
    auth: createAuth({ config: deps.config, db: deps.db, fetchClientMetadata: deps.fetchClientMetadata }),
    catalog,
    submissions: createSubmissions({ repo: createSubmissionsRepository(deps.db), catalog, now, newId }),
    ai:
      deps.ai ??
      (deps.config.anthropic
        ? createAnthropicAi({
            apiKey: deps.config.anthropic.apiKey,
            model: deps.config.anthropic.model ?? undefined,
            baseUrl: deps.config.anthropic.baseUrl ?? undefined,
          })
        : notConfigured),
    fetchPage,
    photoFinder: createPhotoFinder({
      fetchPage,
      stock: deps.photoStock !== undefined ? deps.photoStock : pexels ? createPexelsSearch(pexels) : null,
      web: deps.photoWeb !== undefined ? deps.photoWeb : brave ? createBraveImageSearch(brave) : null,
    }),
    fetchImage: deps.fetchImage ?? createImageFetcher(),
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
    response = await handleMcp(request, services);
  } else if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    response = await handleApiV1(request, services);
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
