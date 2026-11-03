import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["build/", ".react-router/", ".wrangler/", "node_modules/", "hosting/cloudflare/worker-configuration.d.ts"] },
  ...tseslint.configs.recommended,
  {
    // Core-isolation check (supports AC-038): business rules must not depend on
    // the framework, the host, or provider SDKs. Those belong in adapters.
    files: ["server/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["cloudflare:*", "@cloudflare/*", "wrangler"], message: "server/core must not import Cloudflare APIs." },
            { group: ["react-router", "@react-router/*", "react", "react-dom"], message: "server/core must not import UI or framework code." },
            { group: ["better-sqlite3", "drizzle-orm", "drizzle-orm/*"], message: "server/core must use repository interfaces, not database drivers." },
            { group: ["better-auth", "better-auth/*", "@better-auth/*", "@anthropic-ai/*", "@modelcontextprotocol/*"], message: "server/core must not import provider SDKs." },
            { group: ["**/hosting/**", "**/adapters/**", "node:*"], message: "server/core must not import hosts, adapters, or Node APIs." },
          ],
        },
      ],
    },
  },
);
