import { defineConfig } from "vitest/config";

// Live checks against paid services. Run on purpose only: `npm run smoke:ai`.
export default defineConfig({
  test: { include: ["tests/live/**/*.live.ts"], environment: "node" },
});
