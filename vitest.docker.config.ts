import { defineConfig } from "vitest/config";

// Alternative-host check in Docker (M8). Run on purpose: `npm run verify:docker`.
export default defineConfig({
  test: { include: ["tests/docker/**/*.docker.ts"], environment: "node", fileParallelism: false },
});
