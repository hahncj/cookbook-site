// Node runtime for the alternative host. Plain JavaScript, not bundled:
// serves built static assets and passes everything else to the app module.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { createRequestListener } from "@remix-run/node-fetch-server";
import { createNodeApp } from "../../build/server/index.js";

const root = resolve(import.meta.dirname, "../..");
const clientDir = join(root, "build/client");
const port = Number(process.env.PORT ?? 3000);

const app = createNodeApp({
  databasePath: process.env.DATABASE_PATH ?? join(root, "data/cookbook.db"),
  migrationsDir: process.env.MIGRATIONS_DIR ?? join(root, "db/migrations"),
  mediaDir: process.env.MEDIA_DIR ?? join(root, "data/media"),
});

const TYPES = {
  ".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};

async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = resolve(join(clientDir, pathname));
  if (!file.startsWith(clientDir + sep)) return false;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300",
    "X-Robots-Tag": "noindex, nofollow",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
  return true;
}

const handleApp = createRequestListener((request) => app.fetch(request));

const server = createServer(async (req, res) => {
  if (await serveStatic(req, res)) return;
  handleApp(req, res);
});

server.listen(port, () => console.log(`cookbook listening on http://localhost:${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => { app.close(); process.exit(0); }));
}
