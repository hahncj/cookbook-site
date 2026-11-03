import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { isPublicRoutableHost } from "@better-auth/core/utils/host";

/**
 * Runtime-neutral fetch for CIMD client metadata documents (used on Workers,
 * where `@better-auth/cimd/node` cannot run). Guards against server-side
 * request forgery: HTTPS only, GET/HEAD only, no literal private addresses,
 * and redirects are returned rather than followed. Workers cannot reach
 * private networks, so DNS pinning (done by the Node transport) is not needed.
 */
export const fetchClientMetadataViaFetch: ClientMetadataResourceFetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.protocol !== "https:") throw new TypeError("CIMD metadata must be fetched over HTTPS");
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new TypeError("CIMD metadata fetch supports only GET and HEAD");
  }
  if (!isPublicRoutableHost(url.hostname)) {
    throw new TypeError("CIMD metadata host is not publicly routable");
  }
  return fetch(request, { redirect: "manual" });
};
