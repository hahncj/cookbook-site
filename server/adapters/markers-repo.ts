import { and, count, desc, eq, isNull, max, sql } from "drizzle-orm";
import type { MarkerSignal, MarkersRepository } from "../core/markers";
import { recipeMade, recipeMarkers, recipes } from "../db/app-schema";
import { atomic } from "./atomic";
import type { Database } from "./db";

const COLUMN = { favorite: "favoriteAt", wantToTry: "wantToTryAt" } as const;

export function createMarkersRepository(db: Database): MarkersRepository {
  return {
    async get(recipeId) {
      const [[row], made] = await Promise.all([
        db.select().from(recipeMarkers).where(eq(recipeMarkers.recipeId, recipeId)).limit(1),
        db
          .select({ id: recipeMade.id, madeAt: recipeMade.madeAt })
          .from(recipeMade)
          .where(eq(recipeMade.recipeId, recipeId))
          .orderBy(desc(recipeMade.madeAt), desc(recipeMade.id)),
      ]);
      return { favorite: Boolean(row?.favoriteAt), wantToTry: Boolean(row?.wantToTryAt), made };
    },

    async setFlag(recipeId, flag, on, meta) {
      const key = COLUMN[flag];
      const column = recipeMarkers[key];
      // Turning a flag on keeps its first "on" time; turning it off clears it.
      const value = on ? sql`coalesce(${column}, ${meta.now.getTime()})` : null;
      await db
        .insert(recipeMarkers)
        .values({ recipeId, [key]: on ? meta.now : null, updatedAt: meta.now, updatedBy: meta.actor.userId })
        .onConflictDoUpdate({
          target: recipeMarkers.recipeId,
          set: { [key]: value, updatedAt: meta.now, updatedBy: meta.actor.userId },
        });
    },

    async addMade(recipeId, meta) {
      await atomic(db, [
        () => db.insert(recipeMade).values({ id: meta.id, recipeId, madeAt: meta.now, createdBy: meta.actor.userId }),
        ...(meta.clearWantToTry
          ? [
              () =>
                db
                  .update(recipeMarkers)
                  .set({ wantToTryAt: null, updatedAt: meta.now, updatedBy: meta.actor.userId })
                  .where(and(eq(recipeMarkers.recipeId, recipeId), sql`${recipeMarkers.wantToTryAt} is not null`)),
            ]
          : []),
      ]);
    },

    async removeLatestMade(recipeId) {
      const [latest] = await db
        .select({ id: recipeMade.id })
        .from(recipeMade)
        .where(eq(recipeMade.recipeId, recipeId))
        .orderBy(desc(recipeMade.madeAt), desc(recipeMade.id))
        .limit(1);
      if (!latest) return false;
      await db.delete(recipeMade).where(eq(recipeMade.id, latest.id));
      return true;
    },

    async listSignals() {
      const [flags, made] = await Promise.all([
        db
          .select({ recipeId: recipeMarkers.recipeId, favoriteAt: recipeMarkers.favoriteAt, wantToTryAt: recipeMarkers.wantToTryAt })
          .from(recipeMarkers)
          .innerJoin(recipes, eq(recipes.id, recipeMarkers.recipeId))
          .where(isNull(recipes.deletedAt)),
        db
          .select({ recipeId: recipeMade.recipeId, madeCount: count(), lastMadeAt: max(recipeMade.madeAt) })
          .from(recipeMade)
          .innerJoin(recipes, eq(recipes.id, recipeMade.recipeId))
          .where(isNull(recipes.deletedAt))
          .groupBy(recipeMade.recipeId),
      ]);
      const byId = new Map<string, MarkerSignal>();
      const signal = (recipeId: string) => {
        let found = byId.get(recipeId);
        if (!found) {
          found = { recipeId, favorite: false, favoriteAt: null, wantToTry: false, wantToTryAt: null, madeCount: 0, lastMadeAt: null };
          byId.set(recipeId, found);
        }
        return found;
      };
      for (const row of flags) {
        if (!row.favoriteAt && !row.wantToTryAt) continue;
        Object.assign(signal(row.recipeId), {
          favorite: Boolean(row.favoriteAt),
          favoriteAt: row.favoriteAt,
          wantToTry: Boolean(row.wantToTryAt),
          wantToTryAt: row.wantToTryAt,
        });
      }
      for (const row of made) {
        // max() over a timestamp column comes back as the raw number.
        const last = row.lastMadeAt as unknown;
        Object.assign(signal(row.recipeId), {
          madeCount: row.madeCount,
          lastMadeAt: last == null ? null : last instanceof Date ? last : new Date(Number(last)),
        });
      }
      return [...byId.values()];
    },
  };
}
