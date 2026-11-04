// Find a photo for a recipe (E1). Pure logic: which sources are tried in
// which order, reading a page's own recipe photo, and credit lines. Provider
// clients and page fetching are injected (server/importers/).
import { decodeEntities, jsonLdRecipes } from "./imports";

export type PhotoSourceKind = "page" | "stock" | "web";

export interface PhotoCandidate {
  /** Full-size image. Downloaded through the server's SSRF-guarded fetch only when chosen. */
  imageUrl: string;
  /** Smaller image for the picker. */
  previewUrl: string;
  source: PhotoSourceKind;
  /** Saved with the photo and shown under it, e.g. "Photo: Jane Doe / Pixabay". */
  credit: string;
  /** The page the photo is on, so the admin can check it. */
  pageUrl: string | null;
  /** Alt text for the picker. */
  description: string;
}

/** A stock or web image search. Throws on provider errors; the finder moves on. */
export interface PhotoSearchProvider {
  search(query: string, limit: number): Promise<PhotoCandidate[]>;
}

/** Fetches a web page with SSRF protection (same shape as importers/fetch-page). */
export type FinderPageFetcher = (url: string) => Promise<{ ok: true; url: string; html: string } | { ok: false; message: string }>;

export interface PhotoFinderDeps {
  fetchPage: FinderPageFetcher;
  /** Free stock photos (Pixabay); null when not set up. */
  stock: PhotoSearchProvider | null;
  /** General web image search (Brave); null when not set up. */
  web: PhotoSearchProvider | null;
}

export interface FindPhotosRequest {
  title: string;
  sourceUrl: string | null;
  sourceName: string | null;
  /** The admin asked for more choices: search the web. */
  more?: boolean;
}

export interface FindPhotosResult {
  candidates: PhotoCandidate[];
  /** Whether "Search the web for more" can still be offered. */
  webAvailable: boolean;
  /** Plain explanation when nothing was found. */
  message: string | null;
}

export const MAX_PAGE_PHOTOS = 3;
export const MAX_STOCK_PHOTOS = 6;
export const MAX_WEB_PHOTOS = 8;
export const MAX_CREDIT = 200;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Absolute http(s) URL, or null. */
function absoluteImageUrl(raw: unknown, base: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(decodeEntities(raw.trim()), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function imageValues(value: unknown, depth = 0): unknown[] {
  if (depth > 3 || value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => imageValues(item, depth + 1));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [record.url ?? record.contentUrl].filter(Boolean);
  }
  return [];
}

function metaTags(html: string): Record<string, string>[] {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map((tag) => {
    const attrs: Record<string, string> = {};
    for (const m of tag[0].matchAll(/([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) attrs[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? "";
    return attrs;
  });
}

/**
 * The page's own photo of the recipe: the schema.org Recipe `image` first,
 * then its preview image (`og:image`, then `twitter:image`).
 */
export function pageImageUrls(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  const add = (raw: unknown) => {
    const url = absoluteImageUrl(raw, pageUrl);
    if (url && !found.includes(url)) found.push(url);
  };
  const recipe = jsonLdRecipes(html)[0];
  if (recipe) imageValues(recipe.image).forEach(add);
  const metas = metaTags(html);
  for (const key of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]) {
    for (const meta of metas) if ((meta.property ?? meta.name)?.toLowerCase() === key) add(meta.content);
  }
  return found.slice(0, MAX_PAGE_PHOTOS);
}

export function pageCredit(pageUrl: string, sourceName: string | null): string {
  const name = sourceName?.trim() || hostOf(pageUrl) || "the recipe's source";
  return creditLine(name);
}

/** "Photo: Jane Doe / Pixabay". Trimmed to fit storage. */
export function creditLine(by: string, site?: string): string {
  const text = `Photo: ${by.replace(/\s+/g, " ").trim()}${site ? ` / ${site}` : ""}`;
  return text.slice(0, MAX_CREDIT);
}

/** Cleans a credit sent with an upload: one line, limited length, empty → null. */
export function normalizeCredit(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_CREDIT);
  return text || null;
}

async function trySearch(provider: PhotoSearchProvider, query: string, limit: number): Promise<{ results: PhotoCandidate[]; failed: boolean }> {
  try {
    return { results: (await provider.search(query, limit)).slice(0, limit), failed: false };
  } catch {
    return { results: [], failed: true };
  }
}

function dedupe(list: PhotoCandidate[]): PhotoCandidate[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.imageUrl) ? false : (seen.add(c.imageUrl), true)));
}

/**
 * Source order (confirmed 2026-11-04): the recipe's own source page photo,
 * then free stock photos. Web search only when those find nothing, or when
 * the admin asks for more. Nothing is saved here; the admin picks and saves (D2).
 */
export function createPhotoFinder(deps: PhotoFinderDeps) {
  async function fromPage(sourceUrl: string, sourceName: string | null): Promise<PhotoCandidate[]> {
    const page = await deps.fetchPage(sourceUrl);
    if (!page.ok) return [];
    const credit = pageCredit(page.url, sourceName);
    return pageImageUrls(page.html, page.url).map((url) => ({
      imageUrl: url,
      previewUrl: url,
      source: "page" as const,
      credit,
      pageUrl: page.url,
      description: "Photo from the recipe's source page",
    }));
  }

  return {
    sources: { stock: deps.stock !== null, web: deps.web !== null },

    async find(request: FindPhotosRequest): Promise<FindPhotosResult> {
      const title = request.title.replace(/\s+/g, " ").trim().slice(0, 120);
      const sourceUrl = request.sourceUrl?.trim() || null;

      if (request.more) {
        if (!deps.web) return { candidates: [], webAvailable: false, message: "Web image search isn't set up." };
        if (!title) return { candidates: [], webAvailable: true, message: "Add a title first, so there's something to search for." };
        const web = await trySearch(deps.web, title, MAX_WEB_PHOTOS);
        return {
          candidates: dedupe(web.results),
          webAvailable: false,
          message: web.results.length ? null : web.failed ? "The web image search didn't answer. Try again later." : "The web search found no photos.",
        };
      }

      if (!title && !sourceUrl) return { candidates: [], webAvailable: false, message: "Add a title or the recipe's link first." };

      const primary: PhotoCandidate[] = [];
      let failed = false;
      if (sourceUrl) primary.push(...(await fromPage(sourceUrl, request.sourceName)));
      if (deps.stock && title) {
        const stock = await trySearch(deps.stock, title, MAX_STOCK_PHOTOS);
        primary.push(...stock.results);
        failed ||= stock.failed;
      }
      if (primary.length > 0) return { candidates: dedupe(primary), webAvailable: deps.web !== null && Boolean(title), message: null };

      // Nothing from the primary sources: fall back to the web.
      if (deps.web && title) {
        const web = await trySearch(deps.web, title, MAX_WEB_PHOTOS);
        if (web.results.length) return { candidates: dedupe(web.results), webAvailable: false, message: null };
        failed ||= web.failed;
      }
      const tried = [sourceUrl ? "the source page" : null, deps.stock && title ? "stock photos" : null, deps.web && title ? "the web" : null].filter(Boolean);
      const message = failed
        ? "A photo search didn't answer. Try again later."
        : tried.length
          ? `No photos found (looked at ${tried.join(", ")}).`
          : "Add the recipe's link to use its photo. Stock and web photo search aren't set up.";
      return { candidates: [], webAvailable: false, message };
    },
  };
}

export type PhotoFinder = ReturnType<typeof createPhotoFinder>;
