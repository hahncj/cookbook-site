import { test as setup } from "@playwright/test";
import Database from "better-sqlite3";
import { serializeSignedCookie } from "better-call";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { writeFileSync } from "node:fs";
import { E2E } from "../../playwright.config";
import { createServices } from "../../server/app";
import { fetchClientMetadataViaFetch } from "../../server/auth/cimd-fetch";
import { loadConfig } from "../../server/config";
import { validateEntry } from "../../server/core/recipes";
import * as schema from "../../server/db/schema";

// Runs after the server has started (and migrated the database): adds sample
// recipes and an admin session standing in for a completed Google sign-in.
setup("seed sample recipes and an admin session", async () => {
  const sqlite = new Database(`${E2E.dir}/cookbook.db`);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  const config = loadConfig(
    {
      PUBLIC_BASE_URL: E2E.baseURL,
      ADMIN_EMAILS: E2E.adminEmail,
      BETTER_AUTH_SECRET: E2E.secret,
      GOOGLE_CLIENT_ID: "e2e",
      GOOGLE_CLIENT_SECRET: "e2e",
    },
    "node",
  );
  const services = createServices({ config, db, media: null, fetchClientMetadata: fetchClientMetadataViaFetch });
  const actor = { userId: "seed" };
  const collection = await services.catalog.createCollection("Weeknight rotation");

  const samples = [
    {
      kind: "recipe",
      title: "Gochujang Butter Noodles",
      description: "Glossy, spicy-sweet noodles from pantry staples. The weeknight default.",
      notes: "Tried with frozen udon — even better. Next time add a soft egg.",
      yieldText: "Serves 2",
      prepTime: "10 min",
      cookTime: "10 min",
      ingredients: [
        { quantity: "6 oz", item: "dried wheat noodles" },
        { quantity: "2 tbsp", item: "unsalted butter" },
        { quantity: "1½ tbsp", item: "gochujang" },
        { quantity: "", item: "toasted sesame seeds, to taste" },
      ],
      steps: ["Cook the noodles until just tender; reserve ½ cup water.", "Melt butter, add garlic, whisk in gochujang.", "Toss noodles in the sauce."],
      sourceUrl: "https://chatgpt.com/share/example",
      sourceName: "ChatGPT chat",
      tags: ["Weeknight", "Noodles"],
      collectionIds: [collection!.id],
    },
    {
      kind: "recipe",
      title: "Weeknight Black Bean Chili With A Deliberately Long Title To Test Wrapping On Small Phones",
      description: null,
      notes: null,
      yieldText: "Serves 6",
      prepTime: "15 min",
      cookTime: "35 min",
      ingredients: [
        { quantity: "2 cans", item: "black beans" },
        { quantity: "1 tsp", item: "cumin" },
      ],
      steps: ["Simmer everything."],
      sourceUrl: null,
      sourceName: null,
      tags: ["Batch cooking", "Vegetarian"],
      collectionIds: [],
    },
    { kind: "idea", title: "Miso caramel over grilled peaches?", description: null, notes: null, yieldText: null, prepTime: null, cookTime: null, ingredients: [], steps: [], sourceUrl: null, sourceName: null, tags: ["Desserts"], collectionIds: [] },
  ];
  const ids: string[] = [];
  for (const sample of samples) {
    const valid = validateEntry(sample);
    if (!valid.ok) throw new Error(JSON.stringify(valid.errors));
    const created = await services.catalog.create(valid.value, actor);
    if (created.ok) ids.push(created.id);
  }

  const now = new Date();
  const userId = crypto.randomUUID();
  await db.insert(schema.user).values({ id: userId, email: E2E.adminEmail, name: "Admin", emailVerified: true, createdAt: now, updatedAt: now });
  const ctx = await services.auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);
  const cookie = (await serializeSignedCookie("better-auth.session_token", session.token, ctx.secret)).split(";")[0]!;
  const [name, ...rest] = cookie.split("=");
  writeFileSync(`${E2E.dir}/fixtures.json`, JSON.stringify({ recipeId: ids[0], longId: ids[1], ideaId: ids[2], cookie: { name, value: rest.join("=") } }));
  sqlite.close();
});
