import { eq, inArray } from "drizzle-orm";
import type { Database } from "./adapters/db";
import type { MediaStore } from "./adapters/media";
import { IMAGE_CONTENT_TYPES, ImageError, cleanImage, type ImageType } from "./core/images";
import { photos, recipes } from "./db/app-schema";
import { normalizeCredit } from "./core/photo-finder";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_THUMB_BYTES = 1024 * 1024;

export interface StoredPhoto {
  id: string;
  width: number;
  height: number;
  /** Credit line for a found stock or web photo (E1); null for uploads. */
  credit: string | null;
}

export type UploadResult = { ok: true; photo: StoredPhoto } | { ok: false; status: number; message: string };

function photoKey(id: string, ext: ImageType, thumb: boolean) {
  return `photos/${id}${thumb ? "-thumb" : ""}.${ext}`;
}

/**
 * Stores an uploaded photo and its thumbnail. Both are validated by their
 * bytes (not the declared type) and stripped of location and camera metadata.
 * Saving a photo never triggers AI analysis (AC-044).
 */
export async function storePhoto(
  deps: { db: Database; media: MediaStore | null; newId: () => string; now: () => Date },
  files: { full: Uint8Array; thumb: Uint8Array },
  actor: { userId: string },
  /** Only for photos chosen with Find a photo (E1). Taken or uploaded photos have none. */
  credit?: unknown,
): Promise<UploadResult> {
  const creditLine = normalizeCredit(credit);
  if (!deps.media) return { ok: false, status: 503, message: "Photo storage is not configured." };
  if (files.full.length === 0) return { ok: false, status: 400, message: "No photo was received." };
  if (files.full.length > MAX_PHOTO_BYTES) return { ok: false, status: 413, message: "That photo is too large (8 MB maximum)." };
  if (files.thumb.length > MAX_THUMB_BYTES) return { ok: false, status: 413, message: "Thumbnail is too large." };
  let full;
  let thumb;
  try {
    full = cleanImage(files.full);
    thumb = cleanImage(files.thumb);
  } catch (error) {
    if (error instanceof ImageError) return { ok: false, status: 415, message: error.message };
    throw error;
  }
  if (thumb.type !== full.type) return { ok: false, status: 400, message: "Photo and thumbnail formats differ." };

  const id = deps.newId();
  const contentType = IMAGE_CONTENT_TYPES[full.type];
  await deps.media.put(photoKey(id, full.type, false), full.bytes, contentType);
  await deps.media.put(photoKey(id, full.type, true), thumb.bytes, contentType);
  await deps.db.insert(photos).values({
    id,
    recipeId: null,
    ext: full.type,
    contentType,
    width: full.width,
    height: full.height,
    bytes: full.bytes.length,
    thumbBytes: thumb.bytes.length,
    createdAt: deps.now(),
    createdBy: actor.userId,
    credit: creditLine,
  });
  return { ok: true, photo: { id, width: full.width, height: full.height, credit: creditLine } };
}

const PHOTO_PATH = /^\/media\/photos\/([0-9a-f-]{36})(\/thumb)?$/i;

/**
 * GET /media/photos/<id>[/thumb]. Photos of saved, active recipes are public
 * (D3). Photos not yet saved with a recipe, or of deleted recipes, are
 * admin-only. Responses are immutable: a photo id never changes content.
 */
export async function servePhoto(
  request: Request,
  deps: { db: Database; media: MediaStore | null; isAdmin: () => Promise<boolean> },
): Promise<Response> {
  const match = new URL(request.url).pathname.match(PHOTO_PATH);
  if (!match || !deps.media) return new Response("Not found", { status: 404 });
  const id = match[1]!.toLowerCase();
  const [row] = await deps.db
    .select({ ext: photos.ext, contentType: photos.contentType, recipeId: photos.recipeId, deletedAt: recipes.deletedAt })
    .from(photos)
    .leftJoin(recipes, eq(recipes.id, photos.recipeId))
    .where(eq(photos.id, id))
    .limit(1);
  if (!row) return new Response("Not found", { status: 404 });
  const isPublic = row.recipeId !== null && row.deletedAt === null;
  if (!isPublic && !(await deps.isAdmin())) return new Response("Not found", { status: 404 });

  const object = await deps.media.get(photoKey(id, row.ext, Boolean(match[2])));
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(object.size),
      "Cache-Control": isPublic ? "public, max-age=31536000, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/** Reads a stored photo's full-size bytes (for AI ingredient identification). */
export async function readPhotoBytes(
  deps: { db: Database; media: MediaStore | null },
  id: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!deps.media || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await deps.db.select({ ext: photos.ext, contentType: photos.contentType }).from(photos).where(eq(photos.id, id.toLowerCase())).limit(1);
  if (!row) return null;
  const object = await deps.media.get(photoKey(id.toLowerCase(), row.ext, false));
  if (!object) return null;
  return { bytes: new Uint8Array(await new Response(object.body).arrayBuffer()), contentType: row.contentType };
}

/** Credit lines for these photos (E1), keyed by id. Photos without a credit are left out. */
export async function photoCredits(db: Database, ids: string[]): Promise<Record<string, string>> {
  const list = [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) => /^[0-9a-f-]{36}$/.test(id));
  if (list.length === 0) return {};
  const rows = await db.select({ id: photos.id, credit: photos.credit }).from(photos).where(inArray(photos.id, list));
  return Object.fromEntries(rows.filter((row) => row.credit).map((row) => [row.id, row.credit!]));
}
