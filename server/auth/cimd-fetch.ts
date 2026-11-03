import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { isPublicRoutableHost } from "@better-auth/core/utils/host";

/**
 * Runtime-neutral fetch for CIMD client metadata documents (used on Workers,
 * where `@better-auth/cimd/node` cannot run). Guards against server-side
 * request forgery: HTTPS only, GET/HEAD only, no literal private addresses,
 * and redirects are refused. Workers cannot reach private networks, so DNS
 * pinning (done by the Node transport) is not needed.
 *
 * The CIMD plugin asks for `redirect: "error"`, which Cloudflare Workers do
 * not support (only "follow" and "manual"; "error" throws). So this always
 * fetches with "manual" and turns any redirect response into the same thrown
 * error that `redirect: "error"` would produce.
 */
export const fetchClientMetadataViaFetch: ClientMetadataResourceFetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.protocol !== "https:") throw new TypeError("CIMD metadata must be fetched over HTTPS");
  if (method !== "GET" && method !== "HEAD") throw new TypeError("CIMD metadata fetch supports only GET and HEAD");
  if (!isPublicRoutableHost(url.hostname)) throw new TypeError("CIMD metadata host is not publicly routable");

  const response = await fetch(url, {
    method,
    headers: init?.headers ?? (input instanceof Request ? input.headers : undefined),
    signal: init?.signal ?? undefined,
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new TypeError("CIMD metadata fetch must not follow redirects");
  }
  return response;
};
