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

/** Reads the body up to `max` bytes; null when larger. */
async function readBytes(response: Response, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
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
  return bytes;
}

type GuardedResult = { ok: true; url: URL; response: Response } | { ok: false; message: string };

/**
 * GET with the SSRF checks: the URL and every redirect are checked before
 * they are requested. Returns the first non-redirect response.
 */
async function guardedGet(fetchImpl: typeof fetch, raw: string, accept: string, signal: AbortSignal): Promise<GuardedResult> {
  const checked = checkImportUrl(raw);
  if ("message" in checked) return { ok: false, message: checked.message };
  let url = checked.url;
  for (let hop = 0; ; hop++) {
    const response = await fetchImpl(url.toString(), {
      redirect: "manual",
      signal,
      headers: { accept, "user-agent": "Mozilla/5.0 (compatible; 540KitchenRecipeImport/1.0)" },
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
    return { ok: true, url, response };
  }
}

const isTimeout = (error: unknown) => error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");

export function createPageFetcher(fetchImpl: typeof fetch = fetch): PageFetcher {
  return async (raw) => {
    try {
      const result = await guardedGet(fetchImpl, raw, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", AbortSignal.timeout(TIMEOUT_MS));
      if (!result.ok) return result;
      const { response, url } = result;
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
      const bytes = await readBytes(response, MAX_BYTES);
      if (bytes === null) return { ok: false, message: "The page is too large to import." };
      return { ok: true, url: url.toString(), html: new TextDecoder("utf-8", { fatal: false }).decode(bytes) };
    } catch (error) {
      return { ok: false, message: isTimeout(error) ? "The site took too long to answer. Try again or use Paste." : "Couldn't reach that site. Check the link and try again." };
    }
  };
}

// ---------- Images (E1: Find a photo) ----------

export type ImageFetchResult = { ok: true; bytes: Uint8Array<ArrayBuffer>; contentType: string } | { ok: false; message: string };
export type ImageFetcher = (url: string) => Promise<ImageFetchResult>;

export const MAX_FOUND_IMAGE_BYTES = 15 * 1024 * 1024;

/** Recognizes formats browsers can decode for resizing. SVG is refused (it can carry scripts). */
export function sniffImage(bytes: Uint8Array): string | null {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ascii(0, 4) === "GIF8") return "image/gif";
  if (bytes.length >= 12 && ascii(4, 4) === "ftyp" && /^avi[fs]$/.test(ascii(8, 4))) return "image/avif";
  return null;
}

/**
 * Downloads a found photo for the browser to resize, with the same SSRF
 * checks as page fetching. Only real image bytes are passed on.
 */
export function createImageFetcher(fetchImpl: typeof fetch = fetch): ImageFetcher {
  return async (raw) => {
    try {
      const result = await guardedGet(fetchImpl, raw, "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8", AbortSignal.timeout(TIMEOUT_MS));
      if (!result.ok) return result;
      const { response } = result;
      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, message: `The photo couldn't be downloaded (error ${response.status}). Pick another one.` };
      }
      const bytes = await readBytes(response, MAX_FOUND_IMAGE_BYTES);
      if (bytes === null) return { ok: false, message: "That photo is too large. Pick another one." };
      const contentType = sniffImage(bytes);
      if (!contentType) return { ok: false, message: "That link isn't a photo this cookbook can use. Pick another one." };
      return { ok: true, bytes, contentType };
    } catch (error) {
      return { ok: false, message: isTimeout(error) ? "The photo took too long to download. Pick another one." : "Couldn't download that photo. Pick another one." };
    }
  };
}
