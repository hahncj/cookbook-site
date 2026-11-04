// E1: Find a photo for a recipe. Source order, credits (incl. backup and
// restore), admin gating, and the SSRF-guarded download. No real providers.
import { beforeEach, describe, expect, it } from "vitest";
import { createRouterContext } from "../../app/context";
import { action as fetchAction } from "../../app/routes/api.photos.fetch";
import { action as findAction } from "../../app/routes/api.photos.find";
import { action as uploadAction } from "../../app/routes/api.photos";
import { loader as recipeLoader } from "../../app/routes/recipe";
import { loader as editLoader } from "../../app/routes/recipe-edit";
import { action as reviewAction } from "../../app/routes/review";
import type { Services } from "../../server/app";
import { exportBackupData, importRows, TABLE_ORDER } from "../../server/backup";
import { loadConfig } from "../../server/config";
import { createPhotoFinder, pageImageUrls, type PhotoCandidate, type PhotoSearchProvider } from "../../server/core/photo-finder";
import { validateEntry } from "../../server/core/recipes";
import { createImageFetcher, type ImageFetcher } from "../../server/importers/fetch-page";
import { createBraveImageSearch, createPixabaySearch } from "../../server/importers/photo-search";
import { jpegWithMetadata } from "../helpers/images";
import { MemoryMediaStore } from "../helpers/memory-media";
import { ADMIN_EMAIL, BASE_URL, createTestServices, sessionCookieFor } from "../helpers/services";

class FakeSearch implements PhotoSearchProvider {
  calls: string[] = [];
  constructor(
    private readonly results: PhotoCandidate[],
    private readonly fail = false,
  ) {}
  async search(query: string, limit: number) {
    this.calls.push(query);
    if (this.fail) throw new Error("provider down");
    return this.results.slice(0, limit);
  }
}

const candidate = (source: PhotoCandidate["source"], n: number): PhotoCandidate => ({
  imageUrl: `https://img.example.com/${source}-${n}.jpg`,
  previewUrl: `https://img.example.com/${source}-${n}-small.jpg`,
  source,
  credit: source === "stock" ? `Photo: Jane Doe ${n} / Pixabay` : `Photo: site${n}.example.com`,
  pageUrl: null,
  description: "",
});

const RECIPE_PAGE = `<html><head>
<meta property="og:image" content="https://cdn.example.com/og.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"Tomato Soup","image":[{"@type":"ImageObject","url":"/images/soup.jpg"}]}]}</script>
</head><body></body></html>`;

describe("reading the source page's own photo (E1)", () => {
  it("uses the schema.org Recipe image first, then og:image, resolving relative links", () => {
    expect(pageImageUrls(RECIPE_PAGE, "https://food.example.com/soup")).toEqual(["https://food.example.com/images/soup.jpg", "https://cdn.example.com/og.jpg"]);
  });

  it("reads string, array and ImageObject forms, and twitter:image, without duplicates", () => {
    const html = `<meta content="https://a.example.com/t.jpg" name="twitter:image">
      <script type="application/ld+json">{"@type":"Recipe","name":"X","image":["https://a.example.com/1.jpg",{"contentUrl":"https://a.example.com/2.jpg"},"https://a.example.com/1.jpg"]}</script>`;
    expect(pageImageUrls(html, "https://a.example.com/")).toEqual([
      "https://a.example.com/1.jpg",
      "https://a.example.com/2.jpg",
      "https://a.example.com/t.jpg",
    ]);
  });

  it("ignores non-http images and pages with no photo", () => {
    expect(pageImageUrls(`<meta property="og:image" content="javascript:alert(1)">`, "https://a.example.com/")).toEqual([]);
    expect(pageImageUrls("<html></html>", "https://a.example.com/")).toEqual([]);
  });
});

describe("source order (confirmed 2026-11-04)", () => {
  const page = async (url: string) => (url === "https://food.example.com/soup" ? { ok: true as const, url, html: RECIPE_PAGE } : { ok: false as const, message: "404" });

  it("primary: source page photos first, then stock; the web isn't searched", async () => {
    const stock = new FakeSearch([candidate("stock", 1), candidate("stock", 2)]);
    const web = new FakeSearch([candidate("web", 1)]);
    const finder = createPhotoFinder({ fetchPage: page, stock, web });
    const result = await finder.find({ title: "Tomato Soup", sourceUrl: "https://food.example.com/soup", sourceName: "Food Site" });
    expect(result.candidates.map((c) => c.source)).toEqual(["page", "page", "stock", "stock"]);
    expect(result.candidates[0]).toMatchObject({ imageUrl: "https://food.example.com/images/soup.jpg", credit: "Photo: Food Site" });
    expect(stock.calls).toEqual(["Tomato Soup"]);
    expect(web.calls).toEqual([]);
    expect(result.webAvailable).toBe(true);
  });

  it("without a source link, stock photos come first", async () => {
    const stock = new FakeSearch([candidate("stock", 1)]);
    const web = new FakeSearch([candidate("web", 1)]);
    const result = await createPhotoFinder({ fetchPage: page, stock, web }).find({ title: "Soup", sourceUrl: null, sourceName: null });
    expect(result.candidates.map((c) => c.source)).toEqual(["stock"]);
    expect(web.calls).toEqual([]);
  });

  it("secondary: the web is searched when the primary sources find nothing", async () => {
    const stock = new FakeSearch([]);
    const web = new FakeSearch([candidate("web", 1), candidate("web", 2)]);
    const result = await createPhotoFinder({ fetchPage: page, stock, web }).find({ title: "Soup", sourceUrl: "https://food.example.com/missing", sourceName: null });
    expect(stock.calls).toEqual(["Soup"]);
    expect(web.calls).toEqual(["Soup"]);
    expect(result.candidates.map((c) => c.source)).toEqual(["web", "web"]);
    expect(result.webAvailable).toBe(false);
  });

  it("secondary: the web is searched when the admin asks for more, and nothing else is", async () => {
    const fetched: string[] = [];
    const stock = new FakeSearch([candidate("stock", 1)]);
    const web = new FakeSearch([candidate("web", 1)]);
    const finder = createPhotoFinder({ fetchPage: async (url) => (fetched.push(url), page(url)), stock, web });
    const result = await finder.find({ title: "Soup", sourceUrl: "https://food.example.com/soup", sourceName: null, more: true });
    expect(result.candidates.map((c) => c.source)).toEqual(["web"]);
    expect(fetched).toEqual([]);
    expect(stock.calls).toEqual([]);
  });

  it("a failing stock search falls through to the web", async () => {
    const web = new FakeSearch([candidate("web", 1)]);
    const result = await createPhotoFinder({ fetchPage: page, stock: new FakeSearch([], true), web }).find({ title: "Soup", sourceUrl: null, sourceName: null });
    expect(result.candidates.map((c) => c.source)).toEqual(["web"]);
  });

  it("explains when sources aren't set up or nothing was found", async () => {
    const off = createPhotoFinder({ fetchPage: page, stock: null, web: null });
    expect((await off.find({ title: "Soup", sourceUrl: null, sourceName: null })).message).toMatch(/aren't set up/);
    expect((await off.find({ title: "Soup", sourceUrl: null, sourceName: null, more: true })).message).toMatch(/isn't set up/);
    expect((await off.find({ title: "", sourceUrl: null, sourceName: null })).message).toMatch(/title or the recipe's link/);
    const none = createPhotoFinder({ fetchPage: page, stock: new FakeSearch([]), web: new FakeSearch([]) });
    expect((await none.find({ title: "Soup", sourceUrl: null, sourceName: null })).message).toMatch(/No photos found/);
  });
});

describe("providers (fake HTTP, never the real APIs)", () => {
  it("Pixabay: sends the key, safe search on, builds a credit with the photographer", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return Response.json({
        total: 2,
        totalHits: 2,
        hits: [
          {
            pageURL: "https://pixabay.com/photos/soup-1/",
            user: "Jane Doe",
            tags: "soup, tomato, bowl",
            largeImageURL: "https://pixabay.com/get/1_1280.jpg",
            webformatURL: "https://pixabay.com/get/1_640.jpg",
          },
          { user: "No Source" },
        ],
      });
    }) as typeof fetch;
    const results = await createPixabaySearch({ apiKey: "pk", fetchImpl }).search("tomato soup", 6);
    const url = new URL(seen[0]!);
    expect(`${url.origin}${url.pathname}`).toBe("https://pixabay.com/api/");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ key: "pk", q: "tomato soup", image_type: "photo", safesearch: "true", per_page: "6" });
    expect(results).toEqual([
      {
        imageUrl: "https://pixabay.com/get/1_1280.jpg",
        previewUrl: "https://pixabay.com/get/1_640.jpg",
        source: "stock",
        credit: "Photo: Jane Doe / Pixabay",
        pageUrl: "https://pixabay.com/photos/soup-1/",
        description: "Stock photo: soup, tomato, bowl",
      },
    ]);
    // Pixabay needs at least 3 per page.
    await createPixabaySearch({ apiKey: "pk", fetchImpl }).search("soup", 1);
    expect(new URL(seen[1]!).searchParams.get("per_page")).toBe("3");
  });

  it("Brave: sends the key with safe search, credits the site", async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: new Headers(init?.headers) });
      return Response.json({
        results: [
          { title: "Soup", url: "https://www.blog.example.com/soup", properties: { url: "https://www.blog.example.com/soup.jpg" }, thumbnail: { src: "https://imgs.search.brave.com/t.jpg" }, meta_url: { hostname: "www.blog.example.com" } },
        ],
      });
    }) as typeof fetch;
    const results = await createBraveImageSearch({ apiKey: "bk", fetchImpl }).search("soup", 8);
    expect(seen[0]!.url).toContain("https://api.search.brave.com/res/v1/images/search?q=soup&count=8&safesearch=strict");
    expect(seen[0]!.headers.get("x-subscription-token")).toBe("bk");
    expect(results[0]).toMatchObject({ imageUrl: "https://www.blog.example.com/soup.jpg", previewUrl: "https://imgs.search.brave.com/t.jpg", source: "web", credit: "Photo: blog.example.com" });
  });

  it("a provider error throws (the finder moves on)", async () => {
    const fetchImpl = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch;
    await expect(createPixabaySearch({ apiKey: "pk", fetchImpl }).search("x", 1)).rejects.toThrow();
  });

  it("each source is off unless its key is set", () => {
    const base = { PUBLIC_BASE_URL: BASE_URL, ADMIN_EMAILS: ADMIN_EMAIL, BETTER_AUTH_SECRET: "x".repeat(32), GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" };
    expect(loadConfig(base, "node").photoSearch).toEqual({ pixabay: null, brave: null });
    expect(loadConfig({ ...base, PIXABAY_API_KEY: " pk ", BRAVE_SEARCH_API_KEY: "" }, "node").photoSearch).toEqual({ pixabay: { apiKey: "pk", baseUrl: null }, brave: null });
  });
});

describe("downloading a chosen photo uses the SSRF guard", () => {
  it("refuses local and private addresses without making a request", async () => {
    const requested: string[] = [];
    const fetcher = createImageFetcher((async (url: string) => (requested.push(url), new Response(jpegWithMetadata()))) as typeof fetch);
    for (const url of ["http://localhost/a.jpg", "http://127.0.0.1/a.jpg", "http://10.0.0.5/a.jpg", "http://[::1]/a.jpg", "file:///etc/passwd", "http://printer.local/a.jpg"]) {
      expect(await fetcher(url)).toMatchObject({ ok: false });
    }
    expect(requested).toEqual([]);
  });

  it("re-checks redirects", async () => {
    const requested: string[] = [];
    const fetcher = createImageFetcher((async (url: string) => {
      requested.push(url);
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    }) as typeof fetch);
    expect(await fetcher("https://img.example.com/a.jpg")).toMatchObject({ ok: false });
    expect(requested).toEqual(["https://img.example.com/a.jpg"]);
  });

  it("only passes on real image bytes (no SVG or HTML)", async () => {
    const serve = (body: BodyInit) => createImageFetcher((async () => new Response(body)) as unknown as typeof fetch);
    expect(await serve(jpegWithMetadata())("https://img.example.com/a.jpg")).toMatchObject({ ok: true, contentType: "image/jpeg" });
    expect(await serve("<svg onload=alert(1)></svg>")("https://img.example.com/a.svg")).toMatchObject({ ok: false });
    expect(await serve("<html></html>")("https://img.example.com/a")).toMatchObject({ ok: false });
  });
});

// ---------- Routes ----------

let services: Services;
let admin: string;
let pageCalls: string[];
let imageCalls: string[];
let stock: FakeSearch;
let web: FakeSearch;

beforeEach(async () => {
  pageCalls = [];
  imageCalls = [];
  stock = new FakeSearch([candidate("stock", 1)]);
  web = new FakeSearch([candidate("web", 1)]);
  const fetchImage: ImageFetcher = async (url) => (imageCalls.push(url), { ok: true, bytes: new Uint8Array(jpegWithMetadata()), contentType: "image/jpeg" });
  services = createTestServices({
    media: new MemoryMediaStore(),
    fetchPage: async (url) => (pageCalls.push(url), { ok: true, url, html: RECIPE_PAGE }),
    fetchImage,
    photoStock: stock,
    photoWeb: web,
  });
  admin = await sessionCookieFor(services, ADMIN_EMAIL);
});

const args = (request: Request, params: Record<string, string> = {}) => ({ request, params, context: createRouterContext(services) }) as never;

const post = (path: string, fields: Record<string, string | Blob>, cookie?: string) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request(`${BASE_URL}${path}`, { method: "POST", body, headers: cookie ? { Cookie: cookie } : {} });
};

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    const result = await promise;
    return result instanceof Response ? result.status : 200;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    throw thrown;
  }
}

describe("Find a photo is admin-only, checked before any fetch or search", () => {
  it("refuses signed-out (401) and non-admin (403) requests without fetching or searching", async () => {
    const visitor = await sessionCookieFor(services, "someone@example.com");
    const find = { title: "Soup", sourceUrl: "https://food.example.com/soup" };
    expect(await status(findAction(args(post("/api/photos/find", find))))).toBe(401);
    expect(await status(findAction(args(post("/api/photos/find", find, visitor))))).toBe(403);
    expect(await status(findAction(args(post("/api/photos/find", { ...find, more: "1" }, visitor))))).toBe(403);
    expect(await status(fetchAction(args(post("/api/photos/fetch", { url: "https://img.example.com/a.jpg" }))))).toBe(401);
    expect(await status(fetchAction(args(post("/api/photos/fetch", { url: "https://img.example.com/a.jpg" }, visitor))))).toBe(403);
    expect(pageCalls).toEqual([]);
    expect(stock.calls).toEqual([]);
    expect(web.calls).toEqual([]);
    expect(imageCalls).toEqual([]);
  });

  it("returns candidates to an admin and saves nothing", async () => {
    const response = (await findAction(args(post("/api/photos/find", { title: "Soup", sourceUrl: "https://food.example.com/soup" }, admin)))) as Response;
    const body = (await response.json()) as { candidates: PhotoCandidate[]; webAvailable: boolean };
    expect(body.candidates.map((c: PhotoCandidate) => c.source)).toEqual(["page", "page", "stock"]);
    expect(body.webAvailable).toBe(true);
    const more = (await ((await findAction(args(post("/api/photos/find", { title: "Soup", more: "1" }, admin)))) as Response).json()) as { candidates: PhotoCandidate[] };
    expect(more.candidates.map((c: PhotoCandidate) => c.source)).toEqual(["web"]);
    const backup = await exportBackupData(services.db, new Date());
    expect(backup.tables.photos).toEqual([]);
  });

  it("downloads the chosen photo for the browser to resize", async () => {
    const response = (await fetchAction(args(post("/api/photos/fetch", { url: "https://img.example.com/a.jpg" }, admin)))) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(imageCalls).toEqual(["https://img.example.com/a.jpg"]);
  });
});

async function uploadWithCredit(credit?: string) {
  const fields: Record<string, string | Blob> = { full: new Blob([jpegWithMetadata()]), thumb: new Blob([jpegWithMetadata()]) };
  if (credit !== undefined) fields.credit = credit;
  const response = (await uploadAction(args(post("/api/photos", fields, admin)))) as Response;
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; credit: string | null };
}

async function recipeWithPhotos(photos: { id: string; caption: string }[]) {
  const valid = validateEntry({ kind: "recipe", title: "Tomato Soup", ingredients: [], steps: [], tags: [], collectionIds: [], photos });
  if (!valid.ok) throw new Error("invalid");
  const created = await services.catalog.create(valid.value, { userId: "seed" });
  if (!created.ok) throw new Error("not created");
  return created.id;
}

describe("photo credit", () => {
  it("is saved with a found photo and shown with the recipe; uploads have none", async () => {
    const found = await uploadWithCredit("  Photo: Jane Doe   / Pixabay ");
    const uploaded = await uploadWithCredit();
    expect(found.credit).toBe("Photo: Jane Doe / Pixabay");
    expect(uploaded.credit).toBeNull();
    const id = await recipeWithPhotos([
      { id: found.id, caption: "" },
      { id: uploaded.id, caption: "" },
    ]);
    const page = (await recipeLoader(args(new Request(`${BASE_URL}/recipes/${id}`), { id }))) as { credits: Record<string, string> };
    expect(page.credits).toEqual({ [found.id]: "Photo: Jane Doe / Pixabay" });
    const edit = (await editLoader(args(new Request(`${BASE_URL}/recipes/${id}/edit`, { headers: { Cookie: admin } }), { id }))) as {
      values: { photos: { id: string; credit: string | null }[] };
    };
    expect(edit.values.photos.map((p) => p.credit)).toEqual(["Photo: Jane Doe / Pixabay", null]);
  });

  it("is included in backups and comes back on restore", async () => {
    const found = await uploadWithCredit("Photo: Jane Doe / Pixabay");
    const uploaded = await uploadWithCredit();
    await recipeWithPhotos([
      { id: found.id, caption: "" },
      { id: uploaded.id, caption: "" },
    ]);
    const backup = JSON.parse(JSON.stringify(await exportBackupData(services.db, new Date())));
    expect(backup.tables.photos).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: found.id, credit: "Photo: Jane Doe / Pixabay" }), expect.objectContaining({ id: uploaded.id, credit: null })]),
    );

    const fresh = createTestServices({ media: new MemoryMediaStore() });
    for (const table of TABLE_ORDER) expect(await importRows(fresh.db, table, backup.tables[table])).toMatchObject({ ok: true });
    const restored = await exportBackupData(fresh.db, new Date());
    expect(restored.tables.photos.find((p) => p.id === found.id)).toMatchObject({ credit: "Photo: Jane Doe / Pixabay" });
    expect(restored.tables.photos.find((p) => p.id === uploaded.id)).toMatchObject({ credit: null });
  });

  it("older backups without a credit field still restore", async () => {
    const found = await uploadWithCredit("Photo: Jane Doe / Pixabay");
    await recipeWithPhotos([{ id: found.id, caption: "" }]);
    const backup = JSON.parse(JSON.stringify(await exportBackupData(services.db, new Date())));
    for (const row of backup.tables.photos) delete row.credit;
    const fresh = createTestServices({ media: new MemoryMediaStore() });
    for (const table of TABLE_ORDER) expect(await importRows(fresh.db, table, backup.tables[table])).toMatchObject({ ok: true });
    expect((await exportBackupData(fresh.db, new Date())).tables.photos[0]).toMatchObject({ id: found.id, credit: null });
  });
});

describe("Review: a found photo is added on approval", () => {
  const submitter = { credentialKind: "api_key" as const, credentialId: "key-1", clientName: "ChatGPT", userId: "seed" };

  it("attaches the chosen photo to a new recipe that had none", async () => {
    const submitted = await services.submissions.submitNew(submitter, { recipe: { title: "Tomato Soup" }, idempotencyKey: "photo-0001" });
    const submissionId = (submitted as { submissionId: string }).submissionId;
    const photo = await uploadWithCredit("Photo: Jane Doe / Pixabay");
    await reviewAction(args(post("/review", { id: submissionId, intent: "approve", photoId: photo.id }, admin)));
    const applied = await services.submissions.get(submissionId);
    expect(applied?.status).toBe("applied");
    const entry = await services.catalog.get(applied!.resultRecipeId!);
    expect(entry?.photos).toEqual([{ id: photo.id, caption: "" }]);
  });

  it("approving without a photo still works, and non-admins can't approve", async () => {
    const submitted = await services.submissions.submitNew(submitter, { recipe: { title: "Plain Soup" }, idempotencyKey: "photo-0002" });
    const submissionId = (submitted as { submissionId: string }).submissionId;
    const visitor = await sessionCookieFor(services, "someone@example.com");
    expect(await status(reviewAction(args(post("/review", { id: submissionId, intent: "approve" }, visitor))))).toBe(403);
    await reviewAction(args(post("/review", { id: submissionId, intent: "approve" }, admin)));
    const applied = await services.submissions.get(submissionId);
    expect((await services.catalog.get(applied!.resultRecipeId!))?.photos).toEqual([]);
  });
});
