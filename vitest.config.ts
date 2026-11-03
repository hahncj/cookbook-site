import { defineConfig } from "vitest/config";

// Unit and integration tests run on Node against an in-memory SQLite database.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
