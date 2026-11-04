// Alternative-host check (M8, AC-040, AC-041): runs the real Docker image
// twice, adds sample data to the first container, then moves it to the second,
// empty container with the app's own backup and restore code (the same code
// the browser runs). Local only; nothing is deployed and nothing costs money.
//
// Run: npm run verify:docker   (needs Docker; builds the image first)
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { serializeSignedCookie } from "better-call";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBackup, restoreBackup } from "../../app/backup-client";
import { FileMediaStore } from "../../hosting/node/fs-media";
import { createServices } from "../../server/app";
import { fetchClientMetadataViaFetch } from "../../server/auth/cimd-fetch";
import { loadConfig } from "../../server/config";
import { validateEntry, type EntryInput } from "../../server/core/recipes";
import * as schema from "../../server/db/schema";
import { storePhoto } from "../../server/photos";
import { jpegWithMetadata } from "../helpers/images";

const IMAGE = process.env.COOKBOOK_IMAGE ?? "cookbook-m8";
const WORK = resolve(".docker-check");
const ADMIN = "admin@example.com";
const SECRET = "docker-check-secret-docker-check-secret";
const actor = { userId: "seed" };

interface Instance {
  name: string;
  port: number;
  dir: string;
  base: string;
  cookie?: string;
}
const source: Instance = { name: "cookbook-check-a", port: 3200, dir: join(WORK, "a"), base: "http://localhost:3200" };
const target: Instance = { name: "cookbook-check-b", port: 3201, dir: join(WORK, "b"), base: "http://localhost:3201" };

function docker(...args: string[]) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function start(instance: Instance) {
  docker("rm", "-f", instance.name);
  docker(
    "run", "-d", "--name", instance.name, "-p", `${instance.port}:3000`, "-v", `${instance.dir}:/data`,
    "-e", `PUBLIC_BASE_URL=${instance.base}`, "-e", `ADMIN_EMAILS=${ADMIN}`, "-e", `BETTER_AUTH_SECRET=${SECRET}`,
    "-e", "GOOGLE_CLIENT_ID=check", "-e", "GOOGLE_CLIENT_SECRET=check",
    IMAGE,
  );
}

async function waitForHealth(instance: Instance) {
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`${instance.base}/health`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${instance.name} did not become healthy:\n${docker("logs", instance.name)}`);
}

function entry(overrides: Partial<EntryInput>): EntryInput {
  const result = validateEntry({ kind: "recipe", title: "x", ingredients: [], steps: [], tags: [], collectionIds: [], ...overrides });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

/** With the container stopped, opens its database file and adds an admin session (and, for the source, sample data). */
async function seed(instance: Instance, withData: boolean) {
  const sqlite = new Database(join(instance.dir, "cookbook.db"));
  const db = drizzle(sqlite, { schema });
  const config = loadConfig(
    { PUBLIC_BASE_URL: instance.base, ADMIN_EMAILS: ADMIN, BETTER_AUTH_SECRET: SECRET, GOOGLE_CLIENT_ID: "check", GOOGLE_CLIENT_SECRET: "check" },
    "node",
  );
  const media = new FileMediaStore(join(instance.dir, "media"));
  const services = createServices({ config, db, media, fetchClientMetadata: fetchClientMetadataViaFetch });
  const now = new Date();
  const userId = crypto.randomUUID();
  await db.insert(schema.user).values({ id: userId, email: ADMIN, name: "Admin", emailVerified: true, createdAt: now, updatedAt: now });
  const ctx = await services.auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);
  instance.cookie = (await serializeSignedCookie("better-auth.session_token", session.token, ctx.secret)).split(";")[0]!;

  if (withData) {
    const collection = await services.catalog.createCollection("Weeknight rotation");
    const photo = await storePhoto(
      { db, media, newId: () => crypto.randomUUID(), now: () => new Date() },
      { full: jpegWithMetadata(), thumb: jpegWithMetadata() },
      actor,
    );
    if (!photo.ok) throw new Error(photo.message);
    const noodles = entry({
      title: "Docker Check Noodles",
      ingredients: [{ quantity: "6 oz", item: "noodles" }, { quantity: "", item: "salt, to taste" }],
      steps: ["Boil.", "Toss."],
      tags: ["Weeknight"],
      collectionIds: [collection!.id],
      photos: [{ id: photo.photo.id, caption: "Finished dish" }],
    });
    const created = await services.catalog.create(noodles, actor);
    if (!created.ok) throw new Error("create failed");
    await services.catalog.update(created.id, 1, { ...noodles, notes: "Second version." }, actor, { changeNote: "Added a note" });
    await services.catalog.addNote(created.id, "Tried with udon.", actor);
    await services.markers.apply(created.id, "favorite_on", actor);
    await services.markers.apply(created.id, "made_add", actor);
    await services.preferences.add("Likes spicy food", actor);
    const deleted = await services.catalog.create(entry({ kind: "idea", title: "Deleted Idea" }), actor);
    if (deleted.ok) await services.catalog.remove(deleted.id, actor);
  }
  sqlite.close();
}

/** Points the browser backup code at one container, with that container's admin cookie. */
function useInstance(instance: Instance) {
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" && input.startsWith("/") ? instance.base + input : input;
    const headers = new Headers(init.headers);
    headers.set("cookie", instance.cookie!);
    headers.set("origin", instance.base);
    return realFetch(url, { ...init, headers });
  }) as typeof fetch;
}
const realFetch = globalThis.fetch;

async function exportJson(instance: Instance) {
  const response = await realFetch(`${instance.base}/api/backup`, { headers: { cookie: instance.cookie! } });
  expect(response.status).toBe(200);
  return (await response.json()) as { tables: Record<string, Record<string, unknown>[]> };
}

describe("Node + SQLite host in Docker (AC-040, AC-041)", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    rmSync(WORK, { recursive: true, force: true });
    for (const instance of [source, target]) {
      mkdirSync(instance.dir, { recursive: true });
      start(instance); // applies migrations on startup
      await waitForHealth(instance);
      docker("stop", instance.name);
      await seed(instance, instance === source);
      docker("start", instance.name);
      await waitForHealth(instance);
    }
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    for (const instance of [source, target]) {
      try {
        docker("rm", "-f", instance.name);
      } catch {
        // already gone
      }
    }
    rmSync(WORK, { recursive: true, force: true });
  });

  it("serves health, public pages with noindex, and the seeded recipe", async () => {
    const health = await realFetch(`${source.base}/health`).then((r) => r.json());
    expect(health).toMatchObject({ ok: true, host: "node" });
    const home = await realFetch(`${source.base}/?q=noodles`);
    expect(home.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(await home.text()).toContain("Docker Check Noodles");
    const robots = await realFetch(`${source.base}/robots.txt`).then((r) => r.text());
    expect(robots).toMatch(/Disallow: \//);
  });

  it("refuses signed-out writes and AI calls", async () => {
    expect((await realFetch(`${source.base}/api/backup`)).status).toBe(401);
    expect((await realFetch(`${source.base}/discover?q=soup`, { method: "POST" })).status).toBeGreaterThanOrEqual(400);
  });

  it("moves everything to an empty container with the backup file", async () => {
    useInstance(source);
    const { blob, filename } = await buildBackup(() => {});
    expect(filename).toMatch(/^cookbook-backup-\d{4}-\d{2}-\d{2}\.zip$/);

    useInstance(target);
    const restored = await restoreBackup(blob, () => {});
    expect(restored).toEqual({ recipes: 2, photos: 1 });
    globalThis.fetch = realFetch;

    const before = await exportJson(source);
    const after = await exportJson(target);
    for (const table of Object.keys(before.tables)) {
      expect(after.tables[table], table).toEqual(before.tables[table]);
    }
    expect(before.tables.recipe_revisions!.length).toBeGreaterThanOrEqual(2);
    expect(before.tables.preferences!.length).toBe(1);

    // Same photo bytes, served publicly; search works on the restored copy.
    const photoId = before.tables.photos![0]!.id as string;
    const original = new Uint8Array(await (await realFetch(`${source.base}/media/photos/${photoId}`)).arrayBuffer());
    const copy = await realFetch(`${target.base}/media/photos/${photoId}`);
    expect(copy.status).toBe(200);
    expect(new Uint8Array(await copy.arrayBuffer())).toEqual(original);
    expect(await (await realFetch(`${target.base}/?q=noodles`)).text()).toContain("Docker Check Noodles");

    // Running the restore again (as after an interruption) resumes without duplicating anything.
    useInstance(target);
    await restoreBackup(blob, () => {});
    globalThis.fetch = realFetch;
    expect((await exportJson(target)).tables).toEqual(after.tables);
  });
});
