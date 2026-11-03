// Used only by `npm run auth:schema` to generate server/db/auth-schema.ts.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createAuth } from "../server/auth/auth";
import { loadConfig } from "../server/config";
import { fetchClientMetadataViaFetch } from "../server/auth/cimd-fetch";

const config = loadConfig(
  {
    PUBLIC_BASE_URL: "http://localhost:5173",
    ADMIN_EMAILS: "admin@example.com",
    BETTER_AUTH_SECRET: "schema-generation-only-secret-000000000000",
    GOOGLE_CLIENT_ID: "x",
    GOOGLE_CLIENT_SECRET: "x",
  },
  "node",
);

export const auth = createAuth({
  config,
  db: drizzle(new Database(":memory:")),
  fetchClientMetadata: fetchClientMetadataViaFetch,
});
