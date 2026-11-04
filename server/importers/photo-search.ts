// Photo search providers for Find a photo (E1). Each is optional and only
// built when its API key is set (server/config.ts). Tests use fakes; these
// clients are only reached with a real key or the browser tests' mock.
import { creditLine, type PhotoCandidate, type PhotoSearchProvider } from "../core/photo-finder";

const TIMEOUT_MS = 10_000;

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const httpUrl = (value: unknown) => (/^https?:\/\//i.test(str(value)) ? str(value) : "");

async function getJson(fetchImpl: typeof fetch, url: URL, headers: Record<string, string>): Promise<unknown> {
  const response = await fetchImpl(url.toString(), { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Photo search failed (${response.status})`);
  }
  return response.json();
}

/**
 * Free stock photos from Pixabay (https://pixabay.com/api/docs/). Credit:
 * "Photo: <user> / Pixabay". Pixabay asks that its images are not hotlinked
 * permanently; chosen photos are downloaded and stored, so that fits. The key
 * goes in the query string (Pixabay's only option); never log these URLs.
 */
export function createPixabaySearch(options: { apiKey: string; baseUrl?: string | null; fetchImpl?: typeof fetch }): PhotoSearchProvider {
  const base = (options.baseUrl ?? "https://pixabay.com").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async search(query, limit) {
      const url = new URL(`${base}/api/`);
      url.searchParams.set("key", options.apiKey);
      url.searchParams.set("q", query.slice(0, 100));
      url.searchParams.set("image_type", "photo");
      url.searchParams.set("orientation", "horizontal");
      url.searchParams.set("safesearch", "true");
      url.searchParams.set("per_page", String(Math.min(200, Math.max(3, limit)))); // Pixabay allows 3–200
      const body = (await getJson(fetchImpl, url, {})) as { hits?: unknown };
      const hits = Array.isArray(body.hits) ? body.hits : [];
      return hits.flatMap((raw): PhotoCandidate[] => {
        const hit = (raw ?? {}) as Record<string, unknown>;
        const imageUrl = httpUrl(hit.largeImageURL) || httpUrl(hit.webformatURL);
        if (!imageUrl) return [];
        return [
          {
            imageUrl,
            previewUrl: httpUrl(hit.webformatURL) || imageUrl,
            source: "stock",
            credit: creditLine(str(hit.user) || "Unknown photographer", "Pixabay"),
            pageUrl: httpUrl(hit.pageURL) || null,
            description: str(hit.tags) ? `Stock photo: ${str(hit.tags)}` : "Stock photo",
          },
        ];
      });
    },
  };
}

/** Web image search from Brave Search (https://brave.com/search/api/). Credit: "Photo: <site>". */
export function createBraveImageSearch(options: { apiKey: string; baseUrl?: string | null; fetchImpl?: typeof fetch }): PhotoSearchProvider {
  const base = (options.baseUrl ?? "https://api.search.brave.com").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async search(query, limit) {
      const url = new URL(`${base}/res/v1/images/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(limit));
      url.searchParams.set("safesearch", "strict");
      const body = (await getJson(fetchImpl, url, { "x-subscription-token": options.apiKey })) as { results?: unknown };
      const results = Array.isArray(body.results) ? body.results : [];
      return results.flatMap((raw): PhotoCandidate[] => {
        const result = (raw ?? {}) as Record<string, unknown>;
        const properties = (result.properties ?? {}) as Record<string, unknown>;
        const thumbnail = (result.thumbnail ?? {}) as Record<string, unknown>;
        const meta = (result.meta_url ?? {}) as Record<string, unknown>;
        const imageUrl = httpUrl(properties.url);
        if (!imageUrl) return [];
        const site = str(meta.hostname).replace(/^www\./, "") || str(result.source) || "the web";
        return [
          {
            imageUrl,
            previewUrl: httpUrl(thumbnail.src) || imageUrl,
            source: "web",
            credit: creditLine(site),
            pageUrl: httpUrl(result.url) || null,
            description: str(result.title) || "Photo from the web",
          },
        ];
      });
    },
  };
}
