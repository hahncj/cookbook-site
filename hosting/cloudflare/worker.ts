// Cloudflare Workers entry point. The only place that reads Worker bindings.
import { createRequestHandler } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { createRouterContext } from "../../app/context";
import { createServices, handleRequest, type Services } from "../../server/app";
import { fetchClientMetadataViaFetch } from "../../server/auth/cimd-fetch";
import { loadConfig, type AppConfig } from "../../server/config";
import * as schema from "../../server/db/schema";
import { R2MediaStore } from "./r2-media";

const renderPage = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

// Only the parsed configuration (plain data) is cached per isolate.
const configByEnv = new WeakMap<Env, AppConfig>();

function getConfig(env: Env): AppConfig {
  let config = configByEnv.get(env);
  if (!config) {
    config = loadConfig(env as unknown as Record<string, unknown>, "cloudflare");
    configByEnv.set(env, config);
  }
  return config;
}

// Services (including the Better Auth instance) are built per request on
// purpose. Workers cannot resolve a promise created by one request from inside
// another; reusing a Better Auth instance across requests let its lazy
// initialization leak between requests, and sign-in intermittently hung on a
// fresh production isolate. Per-request construction costs about 1–2 ms CPU,
// well inside the free plan's limit (D16).
function buildServices(env: Env): Services {
  return createServices({
    config: getConfig(env),
    db: drizzle(env.DB, { schema }),
    media: env.MEDIA ? new R2MediaStore(env.MEDIA) : null,
    fetchClientMetadata: fetchClientMetadataViaFetch,
  });
}

export default {
  async fetch(request, env) {
    return handleRequest(request, buildServices(env), (req, svc) => renderPage(req, createRouterContext(svc)));
  },
} satisfies ExportedHandler<Env>;
