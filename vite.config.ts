import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

// BUILD_TARGET=cloudflare (default) builds the Worker; BUILD_TARGET=node builds
// the alternative host, using hosting/node/app.ts as the server entry.
const target = process.env.BUILD_TARGET ?? "cloudflare";
if (target !== "cloudflare" && target !== "node") throw new Error(`Unknown BUILD_TARGET: ${target}`);

export default defineConfig(() => ({
  plugins: [
    ...(target === "cloudflare"
      ? [
          cloudflare({
            configPath: "./hosting/cloudflare/wrangler.jsonc",
            viteEnvironment: { name: "ssr" },
            // Same local D1/R2 state that `npm run db:migrate:local` writes to.
            persistState: { path: ".wrangler/state" },
          }),
        ]
      : []),
    reactRouter(),
  ],
  // React Router v8 reads a custom server entry from the SSR environment.
  ...(target === "node"
    ? { environments: { ssr: { build: { rollupOptions: { input: "./hosting/node/app.ts" } } } } }
    : {}),
}));
