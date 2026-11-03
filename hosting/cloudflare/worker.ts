// Cloudflare Workers entry point. The only place that reads Worker bindings.
import { createRequestHandler } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { createRouterContext } from "../../app/context";
import { createServices, handleRequest, type Services } from "../../server/app";
import { fetchClientMetadataViaFetch } from "../../server/auth/cimd-fetch";
import { loadConfig } from "../../server/config";
import * as schema from "../../server/db/schema";
import { R2MediaStore } from "./r2-media";

const renderPage = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

// Services are built once per isolate and reused across requests (Workers keep
// module state between requests). This keeps per-request CPU low on the free
// plan (D16). Keyed by the env object so a new deployment rebuilds them.
const servicesByEnv = new WeakMap<Env, Services>();

function getServices(env: Env): Services {
  let services = servicesByEnv.get(env);
  if (!services) {
    services = createServices({
      config: loadConfig(env as unknown as Record<string, unknown>, "cloudflare"),
      db: drizzle(env.DB, { schema }),
      media: env.MEDIA ? new R2MediaStore(env.MEDIA) : null,
      fetchClientMetadata: fetchClientMetadataViaFetch,
    });
    servicesByEnv.set(env, services);
  }
  return services;
}

export default {
  async fetch(request, env) {
    return handleRequest(request, getServices(env), (req, svc) => renderPage(req, createRouterContext(svc)));
  },
} satisfies ExportedHandler<Env>;
