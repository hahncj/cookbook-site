// Personal feedback markers (workflow 12, AC-056): "Want to try", "Made" and
// "Favorite". Favorite is independent of cooking status, and "made" never
// implies liked. Each "made" is a dated record, so recommendations (M7) can
// use how often and how recently a recipe was cooked. Markers are public to
// read (D3) and only admins change them. They are feedback, not recipe
// content: changing one never creates a recipe version.
import type { Actor } from "./catalog";

export interface MadeRecord {
  id: string;
  madeAt: Date;
}

export interface RecipeMarkers {
  favorite: boolean;
  wantToTry: boolean;
  /** Most recent first. */
  made: MadeRecord[];
}

/** One recipe's feedback as recommendation evidence (M7). Only recipes with at least one marker. */
export interface MarkerSignal {
  recipeId: string;
  favorite: boolean;
  favoriteAt: Date | null;
  wantToTry: boolean;
  wantToTryAt: Date | null;
  madeCount: number;
  lastMadeAt: Date | null;
}

export interface MarkersRepository {
  get(recipeId: string): Promise<RecipeMarkers>;
  setFlag(recipeId: string, flag: "favorite" | "wantToTry", on: boolean, meta: { now: Date; actor: Actor }): Promise<void>;
  /** Records one "made" and, in the same write, clears "want to try" when asked. */
  addMade(recipeId: string, meta: { id: string; now: Date; actor: Actor; clearWantToTry: boolean }): Promise<void>;
  /** Removes the most recent "made" record. False when there was none. */
  removeLatestMade(recipeId: string): Promise<boolean>;
  /** Signals for active (not deleted) recipes that have any marker. */
  listSignals(): Promise<MarkerSignal[]>;
}

export interface MarkersDeps {
  repo: MarkersRepository;
  /** True when the recipe exists and is active. */
  recipeExists: (id: string) => Promise<boolean>;
  now: () => Date;
  newId: () => string;
}

export const MARKER_ACTIONS = ["favorite_on", "favorite_off", "want_on", "want_off", "made_add", "made_undo"] as const;
export type MarkerAction = (typeof MARKER_ACTIONS)[number];

export function parseMarkerAction(value: unknown): MarkerAction | null {
  return typeof value === "string" && (MARKER_ACTIONS as readonly string[]).includes(value) ? (value as MarkerAction) : null;
}

export const NO_MARKERS: RecipeMarkers = { favorite: false, wantToTry: false, made: [] };

export function createMarkers({ repo, recipeExists, now, newId }: MarkersDeps) {
  return {
    get: (recipeId: string) => repo.get(recipeId),

    /**
     * Applies one marker change (admin-only; the caller checks). Toggles set
     * an explicit on/off, so a repeated request changes nothing more.
     * Recording "made" clears "want to try" (it has now been tried); the
     * favorite flag is never touched by cooking status.
     */
    async apply(recipeId: string, action: MarkerAction, actor: Actor): Promise<"ok" | "not_found"> {
      if (!(await recipeExists(recipeId))) return "not_found";
      const meta = { now: now(), actor };
      switch (action) {
        case "favorite_on":
        case "favorite_off":
          await repo.setFlag(recipeId, "favorite", action === "favorite_on", meta);
          break;
        case "want_on":
        case "want_off":
          await repo.setFlag(recipeId, "wantToTry", action === "want_on", meta);
          break;
        case "made_add":
          await repo.addMade(recipeId, { ...meta, id: newId(), clearWantToTry: true });
          break;
        case "made_undo":
          await repo.removeLatestMade(recipeId);
          break;
      }
      return "ok";
    },

    /** Feedback evidence for recommendations (M7). */
    signals: () => repo.listSignals(),
  };
}

export type Markers = ReturnType<typeof createMarkers>;
