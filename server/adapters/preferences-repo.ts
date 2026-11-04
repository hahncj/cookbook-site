import { asc, desc, eq } from "drizzle-orm";
import type { Preference, PreferencesRepository, ProfileRefresh } from "../core/preferences";
import { preferenceRefreshes, preferences } from "../db/app-schema";
import { atomic, changesOf } from "./atomic";
import type { Database } from "./db";

type Row = typeof preferences.$inferSelect;

const toPreference = (row: Row): Preference => ({
  id: row.id,
  statement: row.statement,
  inferredStatement: row.inferredStatement,
  source: row.source,
  status: row.status,
  evidence: row.evidence,
  confidence: row.confidence,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export function createPreferencesRepository(db: Database): PreferencesRepository {
  const values = (item: Preference, userId: string) => ({ ...item, updatedBy: userId });
  return {
    async list() {
      const rows = await db.select().from(preferences).orderBy(asc(preferences.createdAt), asc(preferences.id));
      return rows.map(toPreference);
    },

    async get(id) {
      const [row] = await db.select().from(preferences).where(eq(preferences.id, id)).limit(1);
      return row ? toPreference(row) : null;
    },

    async insert(item, actor) {
      await db.insert(preferences).values(values(item, actor.userId));
    },

    async update(id, changes, meta) {
      const result = await db
        .update(preferences)
        .set({ ...changes, updatedAt: meta.now, updatedBy: meta.actor.userId })
        .where(eq(preferences.id, id));
      return changesOf(result) > 0;
    },

    async remove(id) {
      return changesOf(await db.delete(preferences).where(eq(preferences.id, id))) > 0;
    },

    async replaceSuggestions(items, refresh, actor) {
      await atomic(db, [
        () => db.delete(preferences).where(eq(preferences.status, "suggested")),
        ...items.map((item) => () => db.insert(preferences).values(values(item, actor.userId))),
        () => db.insert(preferenceRefreshes).values({ ...refresh, createdBy: actor.userId }),
      ]);
    },

    async latestRefresh(): Promise<ProfileRefresh | null> {
      const [row] = await db.select().from(preferenceRefreshes).orderBy(desc(preferenceRefreshes.createdAt)).limit(1);
      return row ? { id: row.id, recipeCount: row.recipeCount, note: row.note, createdAt: row.createdAt } : null;
    },
  };
}
