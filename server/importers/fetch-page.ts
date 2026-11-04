// Fetches a recipe web page for link import (M5) with SSRF protection:
// http(s) only, standard ports, no private or local hosts, each redirect is
// re-checked, a size cap and a timeout. Workers can't reach private networks
// anyway; on Node, literal private addresses and local names are refused.
import { isPublicRoutableHost } from "@better-auth/core/utils/host";

export type PageResult =
  | { ok: true; url: string; html: string }
  | { ok: false; message: string };

export type PageFetcher = (url: string) => Promise<PageResult>;

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;

/** Returns a message if the URL may not be fetched, otherwise null. */
export function checkImportUrl(raw: string): { url: URL } | { message: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { message: "That doesn't look like a web address. It should start with https://" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { message: "Only http and https links can be imported." };
  if (url.username || url.password) return { message: "Links with a username or password can't be imported." };
  if (url.port && url.port !== "80" && url.port !== "443") return { message: "Links on unusual ports can't be imported." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return { message: "That address isn't on the public internet." };
  if (/\.(local|localhost|internal|lan|home|corp)$/i.test(host) || !isPublicRoutableHost(host))
    return { message: "That address isn't on the public internet." };
  return { url };
}

async function readLimited(response: Response): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function createPageFetcher(fetchImpl: typeof fetch = fetch): PageFetcher {
  return async (raw) => {
    const checked = checkImportUrl(raw);
    if ("message" in checked) return { ok: false, message: checked.message };
    let url = checked.url;
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      for (let hop = 0; ; hop++) {
        const response = await fetchImpl(url.toString(), {
          redirect: "manual",
          signal,
          headers: {
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
            "user-agent": "Mozilla/5.0 (compatible; 540KitchenRecipeImport/1.0)",
          },
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const location = response.headers.get("location");
          if (!location || hop >= MAX_REDIRECTS) return { ok: false, message: "The page redirected too many times." };
          const next = checkImportUrl(new URL(location, url).toString());
          if ("message" in next) return { ok: false, message: `The page redirected somewhere that can't be imported. ${next.message}` };
          url = next.url;
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          return {
            ok: false,
            message:
              response.status === 403 || response.status === 401
                ? "The site blocked the import. Copy the recipe text and use Paste instead."
                : `The page couldn't be loaded (error ${response.status}).`,
          };
        }
        const type = response.headers.get("content-type") ?? "";
        if (type && !/html|xml|text\/plain/i.test(type)) {
          await response.body?.cancel();
          return { ok: false, message: "That link isn't a web page. For a photo or PDF, use the Photo tab." };
        }
        const html = await readLimited(response);
        if (html === null) return { ok: false, message: "The page is too large to import." };
        return { ok: true, url: url.toString(), html };
      }
    } catch (error) {
      const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
      return { ok: false, message: timedOut ? "The site took too long to answer. Try again or use Paste." : "Couldn't reach that site. Check the link and try again." };
    }
  };
}
