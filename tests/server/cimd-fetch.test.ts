import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchClientMetadataViaFetch } from "../../server/auth/cimd-fetch";

const DOC = "https://claude.ai/oauth/mcp-oauth-client-metadata";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  const spy = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("CIMD metadata fetch on Workers", () => {
  it("never passes redirect: 'error' to fetch (unsupported on Workers)", async () => {
    const spy = stubFetch(Response.json({ client_id: DOC }));
    // This is exactly how @better-auth/cimd calls the hook.
    const res = await fetchClientMetadataViaFetch(DOC, {
      headers: new Headers({ Accept: "application/json" }),
      redirect: "error",
      signal: new AbortController().signal,
    });
    expect(res.status).toBe(200);
    const init = spy.mock.calls[0]![1];
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
    expect(init.method).toBe("GET");
  });

  it("refuses redirects", async () => {
    stubFetch(new Response(null, { status: 302, headers: { Location: "https://evil.example/doc" } }));
    await expect(fetchClientMetadataViaFetch(DOC, { redirect: "error" })).rejects.toThrow(/redirect/);
  });

  it("refuses non-HTTPS, non-GET, and private hosts without fetching", async () => {
    const spy = stubFetch(Response.json({}));
    await expect(fetchClientMetadataViaFetch("http://claude.ai/doc")).rejects.toThrow(/HTTPS/);
    await expect(fetchClientMetadataViaFetch(DOC, { method: "POST" })).rejects.toThrow(/GET and HEAD/);
    await expect(fetchClientMetadataViaFetch("https://127.0.0.1/doc")).rejects.toThrow(/publicly routable/);
    await expect(fetchClientMetadataViaFetch("https://10.0.0.5/doc")).rejects.toThrow(/publicly routable/);
    expect(spy).not.toHaveBeenCalled();
  });
});
