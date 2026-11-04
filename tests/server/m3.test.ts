import { beforeEach, describe, expect, it } from "vitest";
import type { Services } from "../../server/app";
import { exportBackupData, importPhotoFile, importRows, isCatalogEmpty, TABLE_ORDER } from "../../server/backup";
import { validateEntry, type EntryInput } from "../../server/core/recipes";
import { servePhoto, storePhoto } from "../../server/photos";
import { contains, jpegWithMetadata } from "../helpers/images";
import { MemoryMediaStore } from "../helpers/memory-media";
import { BASE_URL, createTestServices } from "../helpers/services";

const actor = { userId: "admin-1" };

function input(overrides: Partial<EntryInput> = {}): EntryInput {
  const result = validateEntry({
    kind: "recipe",
    title: "Gochujang Butter Noodles",
    ingredients: [
      { quantity: "6 oz", item: "noodles" },
      { quantity: "2 tsp", item: "honey" },
    ],
    steps: ["Boil.", "Toss."],
    tags: ["Weeknight"],
    collectionIds: [],
    ...overrides,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

let media: MemoryMediaStore;
let services: Services;

beforeEach(() => {
  media = new MemoryMediaStore();
  services = createTestServices({ media });
});

async function upload(deps = services, store = media) {
  const result = await storePhoto(
    { db: deps.db, media: store, newId: () => crypto.randomUUID(), now: () => new Date() },
    { full: jpegWithMetadata(), thumb: jpegWithMetadata() },
    actor,
  );
  if (!result.ok) throw new Error(result.message);
  return result.photo;
}

function getPhoto(id: string, isAdmin: boolean, deps = services, store = media, thumb = false) {
  return servePhoto(new Request(`${BASE_URL}/media/photos/${id}${thumb ? "/thumb" : ""}`), {
    db: deps.db,
    media: store,
    isAdmin: async () => isAdmin,
  });
}

describe("version history (AC-050, AC-051, AC-058)", () => {
  it("records a version for every save, with notes and origin", async () => {
    const created = await services.catalog.create(input(), actor, { changeNote: "From my ChatGPT chat" });
    const id = created.ok ? created.id : "";
    await services.catalog.update(id, 1, input({ title: "Less-sweet Noodles", ingredients: [{ quantity: "6 oz", item: "noodles" }, { quantity: "1 tsp", item: "honey" }] }), actor, {
      changeNote: "Halved the honey",
    });
    const history = await services.catalog.history(id);
    expect(history.map((v) => [v.revision, v.origin, v.changeNote])).toEqual([
      [2, "edit", "Halved the honey"],
      [1, "create", "From my ChatGPT chat"],
    ]);
    const detail = await services.catalog.revisionDetail(id, 2);
    expect(detail?.changesFromPrevious).toEqual([
      { field: "title", label: "Title", type: "text", before: "Gochujang Butter Noodles", after: "Less-sweet Noodles" },
      { field: "ingredients", label: "Ingredients", type: "list", removed: ["2 tsp honey"], added: ["1 tsp honey"] },
    ]);
    expect(detail?.changesToCurrent).toEqual([]);
  });

  it("restores an old version as a new version, keeping everything in between", async () => {
    const created = await services.catalog.create(input(), actor);
    const id = created.ok ? created.id : "";
    await services.catalog.update(id, 1, input({ title: "Bad AI edit", tags: ["Oops"] }), actor);
    const restored = await services.catalog.restoreRevision(id, 1, 2, actor);
    expect(restored).toEqual({ ok: true, id });
    const entry = await services.catalog.get(id);
    expect(entry).toMatchObject({ title: "Gochujang Butter Noodles", revision: 3, tags: [{ name: "Weeknight" }] });
    const history = await services.catalog.history(id);
    expect(history.map((v) => [v.revision, v.origin, v.restoredFrom])).toEqual([
      [3, "restore", 1],
      [2, "edit", null],
      [1, "create", null],
    ]);
    expect((await services.catalog.revisionDetail(id, 2))?.revision.snapshot.title).toBe("Bad AI edit");
  });

  it("refuses to restore over newer edits (conflict check)", async () => {
    const created = await services.catalog.create(input(), actor);
    const id = created.ok ? created.id : "";
    await services.catalog.update(id, 1, input({ title: "Newer edit" }), actor);
    expect(await services.catalog.restoreRevision(id, 1, 1, actor)).toEqual({ ok: false, reason: "conflict" });
    expect((await services.catalog.get(id))?.title).toBe("Newer edit");
    expect((await services.catalog.history(id)).length).toBe(2);
  });

  it("a losing concurrent update adds no version", async () => {
    const created = await services.catalog.create(input(), actor);
    const id = created.ok ? created.id : "";
    await services.catalog.update(id, 1, input({ title: "A" }), actor);
    expect(await services.catalog.update(id, 1, input({ title: "B" }), actor)).toEqual({ ok: false, reason: "conflict" });
    expect((await services.catalog.history(id)).map((v) => v.revision)).toEqual([2, 1]);
  });

  it("keeps dated experiment notes without creating versions", async () => {
    const created = await services.catalog.create(input(), actor);
    const id = created.ok ? created.id : "";
    expect(await services.catalog.addNote(id, "  Tried udon — better.  ", actor)).toBe("ok");
    expect(await services.catalog.addNote(id, "   ", actor)).toBe("empty");
    expect(await services.catalog.addNote("missing", "x", actor)).toBe("not_found");
    expect((await services.catalog.listNotes(id)).map((n) => n.body)).toEqual(["Tried udon — better."]);
    expect((await services.catalog.get(id))?.revision).toBe(1);
  });
});

describe("photos (AC-006, AC-044)", () => {
  it("stores photos without location metadata", async () => {
    const photo = await upload();
    expect(photo).toMatchObject({ width: 32, height: 16 });
    const stored = [...media.objects.entries()];
    expect(stored.map(([key]) => key).sort()).toEqual([`photos/${photo.id}-thumb.jpg`, `photos/${photo.id}.jpg`]);
    for (const [, object] of stored) {
      expect(object.contentType).toBe("image/jpeg");
      expect(contains(object.bytes, "GPS")).toBe(false);
      expect(contains(object.bytes, "Exif")).toBe(false);
    }
  });

  it("rejects non-images and oversized files", async () => {
    const deps = { db: services.db, media, newId: () => crypto.randomUUID(), now: () => new Date() };
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(await storePhoto(deps, { full: html, thumb: html }, actor)).toMatchObject({ ok: false, status: 415 });
    expect(await storePhoto(deps, { full: new Uint8Array(9 * 1024 * 1024), thumb: jpegWithMetadata() }, actor)).toMatchObject({ ok: false, status: 413 });
    expect(media.objects.size).toBe(0);
  });

  it("serves photos publicly only once saved with an active recipe", async () => {
    const photo = await upload();
    expect((await getPhoto(photo.id, false)).status).toBe(404); // not yet saved with a recipe
    expect((await getPhoto(photo.id, true)).status).toBe(200); // admin preview in the editor

    const created = await services.catalog.create(input({ photos: [{ id: photo.id, caption: "Finished dish" }] }), actor);
    const id = created.ok ? created.id : "";
    const pub = await getPhoto(photo.id, false);
    expect(pub.status).toBe(200);
    expect(pub.headers.get("Content-Type")).toBe("image/jpeg");
    expect(pub.headers.get("Cache-Control")).toContain("immutable");
    expect((await getPhoto(photo.id, false, services, media, true)).status).toBe(200);

    const entry = await services.catalog.get(id);
    expect(entry?.photos).toEqual([{ id: photo.id, caption: "Finished dish" }]);
    expect((await services.catalog.browse({})).items[0]?.coverPhoto).toEqual({ id: photo.id, caption: "Finished dish" });

    await services.catalog.remove(id, actor);
    expect((await getPhoto(photo.id, false)).status).toBe(404); // deleted recipes are private (D3, D6)
    expect((await getPhoto(photo.id, true)).status).toBe(200);
  });

  it("ignores photo ids that were never uploaded", async () => {
    const created = await services.catalog.create(input({ photos: [{ id: crypto.randomUUID(), caption: "forged" }] }), actor);
    expect((await services.catalog.get(created.ok ? created.id : ""))?.photos).toEqual([]);
  });

  it("restoring a version brings back its photos", async () => {
    const photo = await upload();
    const created = await services.catalog.create(input({ photos: [{ id: photo.id, caption: "" }] }), actor);
    const id = created.ok ? created.id : "";
    await services.catalog.update(id, 1, input({ photos: [] }), actor);
    expect((await services.catalog.get(id))?.photos).toEqual([]);
    await services.catalog.restoreRevision(id, 1, 2, actor);
    expect((await services.catalog.get(id))?.photos).toEqual([{ id: photo.id, caption: "" }]);
  });
});

describe("backup and restore into a fresh instance (AC-041, AC-053, AC-061)", () => {
  it("round-trips recipes, history, notes, tags, collections, deleted entries and photos with their ids", async () => {
    // Source cookbook
    const collection = await services.catalog.createCollection("Weeknight rotation");
    const photo = await upload();
    const a = await services.catalog.create(
      input({ collectionIds: [collection!.id], photos: [{ id: photo.id, caption: "Finished dish" }] }),
      actor,
      { changeNote: "First save" },
    );
    const aId = a.ok ? a.id : "";
    await services.catalog.update(aId, 1, input({ title: "Noodles v2", collectionIds: [collection!.id], photos: [{ id: photo.id, caption: "Finished dish" }] }), actor);
    await services.catalog.addNote(aId, "Tried udon.", actor);
    const b = await services.catalog.create(input({ kind: "idea", title: "Miso peaches?", ingredients: [], steps: [], tags: ["Desserts"] }), actor);
    const bId = b.ok ? b.id : "";
    await services.catalog.remove(bId, actor);

    const backup = JSON.parse(JSON.stringify(await exportBackupData(services.db, new Date())));
    expect(backup.format).toBe("cookbook-backup");
    expect(JSON.stringify(backup)).not.toMatch(/session|oauth|secret/i);

    // Fresh cookbook
    const freshMedia = new MemoryMediaStore();
    const fresh = createTestServices({ media: freshMedia });
    expect(await isCatalogEmpty(fresh.db)).toBe(true);
    for (const table of TABLE_ORDER) {
      const rows = backup.tables[table];
      for (let i = 0; i < rows.length; i += 2) {
        expect(await importRows(fresh.db, table, rows.slice(i, i + 2))).toMatchObject({ ok: true });
      }
    }
    // Re-sending a chunk is harmless.
    expect(await importRows(fresh.db, "recipes", backup.tables.recipes)).toMatchObject({ ok: true });
    for (const [key, object] of media.objects) {
      expect(await importPhotoFile(fresh.db, freshMedia, key, object.bytes)).toMatchObject({ ok: true });
    }
    expect(await isCatalogEmpty(fresh.db)).toBe(false);

    const restored = await fresh.catalog.get(aId);
    expect(restored).toMatchObject({
      id: aId,
      title: "Noodles v2",
      revision: 2,
      tags: [{ name: "Weeknight" }],
      collections: [{ id: collection!.id, name: "Weeknight rotation" }],
      photos: [{ id: photo.id, caption: "Finished dish" }],
    });
    expect((await fresh.catalog.history(aId)).map((v) => [v.revision, v.changeNote])).toEqual([
      [2, null],
      [1, "First save"],
    ]);
    expect((await fresh.catalog.listNotes(aId)).map((n) => n.body)).toEqual(["Tried udon."]);
    expect(await fresh.catalog.get(bId)).toBeNull();
    expect((await fresh.catalog.listDeleted()).map((e) => e.id)).toEqual([bId]);
    expect((await fresh.catalog.browse({ q: "noodles" })).total).toBe(1); // search index rebuilt
    const served = await getPhoto(photo.id, false, fresh, freshMedia);
    expect(served.status).toBe(200);
  });

  it("rejects malformed rows and unknown tables", async () => {
    const fresh = createTestServices();
    expect(await importRows(fresh.db, "user", [{}])).toMatchObject({ ok: false });
    expect(await importRows(fresh.db, "recipes", [{ id: "x", title: "" }])).toMatchObject({ ok: false });
    expect(await importPhotoFile(fresh.db, new MemoryMediaStore(), "../../etc/passwd", new Uint8Array())).toMatchObject({ ok: false });
    expect(await isCatalogEmpty(fresh.db)).toBe(true);
  });
});
