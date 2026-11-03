import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";

// Web-streams rendering works on both hosts: Cloudflare Workers (edge build
// of react-dom) and Node (react-dom's Node build also provides it).
export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  let shellRendered = false;
  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      responseStatusCode = 500;
      // Errors before the shell renders reject the promise and are logged by React Router.
      if (shellRendered) console.error(error);
    },
  });
  shellRendered = true;

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}
