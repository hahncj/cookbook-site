// Browser-side backup and restore (D7). The browser assembles and unpacks the
// zip so no server request does heavy work on the free plan (D16).
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { photoUrl } from "./photo-prepare";

export interface Progress {
  label: string;
  done: number;
  total: number;
}

interface BackupJson {
  format: string;
  version: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
}

/** Downloads everything (data + photos) and returns the zip and a file name. */
export async function buildBackup(onProgress: (p: Progress) => void): Promise<{ blob: Blob; filename: string }> {
  onProgress({ label: "Collecting recipes", done: 0, total: 1 });
  const response = await fetch("/api/backup", { credentials: "same-origin" });
  if (!response.ok) throw new Error(await readError(response, "Couldn't read the cookbook data."));
  const data = (await response.json()) as BackupJson;

  const files: Zippable = { "backup.json": [strToU8(JSON.stringify(data, null, 2)), { level: 6 }] };
  const photos = (data.tables.photos ?? []) as { id: string; ext: string }[];
  let done = 0;
  for (const photo of photos) {
    onProgress({ label: "Adding photos", done, total: photos.length });
    for (const size of ["full", "thumb"] as const) {
      const file = await fetch(photoUrl(photo.id, size), { credentials: "same-origin" });
      if (!file.ok) throw new Error(`Couldn't download a photo (${photo.id}). Try again.`);
      const key = `photos/${photo.id}${size === "thumb" ? "-thumb" : ""}.${photo.ext}`;
      files[key] = [new Uint8Array(await file.arrayBuffer()), { level: 0 }];
    }
    done++;
  }
  onProgress({ label: "Packing", done: photos.length, total: photos.length });
  const zipped = zipSync(files);
  const stamp = data.exportedAt.slice(0, 10);
  return { blob: new Blob([new Uint8Array(zipped)], { type: "application/zip" }), filename: `cookbook-backup-${stamp}.zip` };
}

export function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function post(url: string, body: BodyInit, headers: Record<string, string> = {}) {
  const response = await fetch(url, { method: "POST", body, headers, credentials: "same-origin" });
  if (!response.ok) throw new Error(await readError(response, "The restore stopped because of a server error."));
  return response.json() as Promise<Record<string, unknown>>;
}

/** Restores a backup zip into an empty cookbook. Safe to retry if interrupted. */
export async function restoreBackup(file: Blob, onProgress: (p: Progress) => void): Promise<{ recipes: number; photos: number }> {
  onProgress({ label: "Reading the backup", done: 0, total: 1 });
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("That file isn't a cookbook backup (it couldn't be opened as a zip).");
  }
  const json = entries["backup.json"];
  if (!json) throw new Error("That zip doesn't contain backup.json, so it isn't a cookbook backup.");
  const data = JSON.parse(strFromU8(json)) as BackupJson;

  const begin = await post(
    "/api/backup/restore",
    JSON.stringify({
      step: "begin",
      format: data.format,
      version: data.version,
      ids: Object.fromEntries(
        ["recipes", "tags", "collections", "photos"].map((table) => [table, (data.tables[table] ?? []).map((row) => row.id)]),
      ),
    }),
    { "Content-Type": "application/json" },
  );
  const order = begin.tableOrder as string[];
  const chunkSize = begin.chunkSize as number;

  const totalRows = order.reduce((sum, table) => sum + (data.tables[table]?.length ?? 0), 0);
  let rowsDone = 0;
  for (const table of order) {
    const rows = data.tables[table] ?? [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      onProgress({ label: "Restoring recipes and history", done: rowsDone, total: totalRows });
      await post("/api/backup/restore", JSON.stringify({ step: "rows", table, rows: rows.slice(i, i + chunkSize) }), {
        "Content-Type": "application/json",
      });
      rowsDone += Math.min(chunkSize, rows.length - i);
    }
  }

  const photoKeys = Object.keys(entries).filter((key) => key.startsWith("photos/"));
  for (const [index, key] of photoKeys.entries()) {
    onProgress({ label: "Restoring photos", done: index, total: photoKeys.length });
    await post(`/api/backup/photo?key=${encodeURIComponent(key)}`, new Uint8Array(entries[key]!), {
      "Content-Type": "application/octet-stream",
    });
  }
  onProgress({ label: "Done", done: 1, total: 1 });
  return { recipes: data.tables.recipes?.length ?? 0, photos: (data.tables.photos ?? []).length };
}
