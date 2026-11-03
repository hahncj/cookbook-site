// Node host app module. Built as the SSR entry for BUILD_TARGET=node, so it
// shares one module graph with the React Router server build.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { createRequestHandler } from "react-router";
import * as build from "virtual:react-router/server-build";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRouterContext } from "../../app/context";
import { createServices, handleRequest, type Services } from "../../server/app";
import { loadConfig } from "../../server/config";
import * as schema from "../../server/db/schema";
import { FileMediaStore } from "./fs-media";

export interface NodeAppOptions {
  databasePath: string;
  migrationsDir: string;
  mediaDir: string;
}

export function createNodeApp(options: NodeAppOptions) {
  const config = loadConfig(process.env, "node");

  mkdirSync(dirname(options.databasePath), { recursive: true });
  const sqlite = new Database(options.databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: options.migrationsDir });

  // Unlike Workers, a long-lived process can build services once.
  const services: Services = createServices({
    config,
    db,
    media: new FileMediaStore(options.mediaDir),
    fetchClientMetadata: fetchClientMetadataResource,
  });
  const renderPage = createRequestHandler(build, process.env.NODE_ENV ?? "production");

  return {
    fetch: (request: Request) =>
      handleRequest(request, services, (req, svc) => renderPage(req, createRouterContext(svc))),
    close: () => sqlite.close(),
  };
}
