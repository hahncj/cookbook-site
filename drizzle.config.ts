import { defineConfig } from "drizzle-kit";

// One migration history for both hosts: Wrangler applies the .sql files to D1;
// the Node host applies the same files with Drizzle's migrator.
export default defineConfig({
  dialect: "sqlite",
  schema: "./server/db/schema.ts",
  out: "./db/migrations",
});
