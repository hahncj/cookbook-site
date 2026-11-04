import type { Services } from "./app";
import type { SubmitResult } from "./core/submissions";
import { idempotencyKeySchema } from "./core/submissions";
import { recipeForTools, summaryForTools } from "./integration";
import { authenticateTool } from "./tool-auth";

/**
 * HTTP API for AI tools that don't use MCP (docs/integration.md). Same
 * operations, validation and approval rules as the MCP tools (AC-025).
 *
 *   GET  /api/v1/recipes?query=&tag=&page=
 *   GET  /api/v1/recipes/{id}
 *   POST /api/v1/recipes                     { recipe, note? }                    + Idempotency-Key
 *   POST /api/v1/recipes/{id}/updates        { expectedRevision, changes, note? } + Idempotency-Key
 *   GET  /api/v1/submissions/{id}
 */
const MAX_BODY = 256 * 1024;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });

function statusCode(outcome: SubmitResult): number {
  switch (outcome.status) {
    case "pending":
      return 202;
    case "applied":
      return 201;
    case "rejected":
      return 200;
    case "conflict":
      return 409;
    case "not_found":
      return 404;
    case "validation_failed":
      return 422;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) return json({ status: "validation_failed", message: "Request body is too large." }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ status: "validation_failed", message: "Request body is too large." }, 413);
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  return json({ status: "validation_failed", message: "Expected a JSON object." }, 400);
}

function idempotencyKey(request: Request, body: Record<string, unknown>): string | Response {
  const key = request.headers.get("idempotency-key") ?? body.idempotencyKey;
  const parsed = idempotencyKeySchema.safeParse(key);
  if (!parsed.success) {
    return json(
      { status: "validation_failed", message: "Send a unique Idempotency-Key header (8–100 letters, digits, '.', '_', ':' or '-'), e.g. a UUID." },
      400,
    );
  }
  return parsed.data;
}

export async function handleApiV1(request: Request, services: Services): Promise<Response> {
  const auth = await authenticateTool(request, services);
  if (!auth.ok) {
    return json({ status: "unauthorized", message: "Send an API key or OAuth access token as 'Authorization: Bearer …'." }, 401, {
      "WWW-Authenticate": `Bearer realm="cookbook"${auth.reason === "invalid" ? ', error="invalid_token"' : ""}`,
    });
  }
  const { submitter } = auth;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/v1/, "").replace(/\/+$/, "");
  const baseUrl = services.config.baseUrl;
  const method = request.method;

  if (method === "GET" && path === "/recipes") {
    const found = await services.catalog.browse({
      q: url.searchParams.get("query") ?? "",
      tag: url.searchParams.get("tag") ?? "",
      page: Number(url.searchParams.get("page") ?? "1") || 1,
    });
    return json({ total: found.total, page: found.page, pageCount: found.pageCount, recipes: found.items.map((e) => summaryForTools(e, baseUrl)) });
  }

  let match = path.match(/^\/recipes\/([^/]+)$/);
  if (method === "GET" && match) {
    const entry = await services.catalog.get(decodeURIComponent(match[1]!));
    return entry ? json(recipeForTools(entry, baseUrl)) : json({ status: "not_found", message: "No recipe with that id." }, 404);
  }

  if (method === "POST" && path === "/recipes") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const key = idempotencyKey(request, body);
    if (key instanceof Response) return key;
    const outcome = await services.submissions.submitNew(submitter, {
      recipe: body.recipe,
      idempotencyKey: key,
      note: typeof body.note === "string" ? body.note : null,
    });
    return json(outcome, statusCode(outcome));
  }

  match = path.match(/^\/recipes\/([^/]+)\/updates$/);
  if (method === "POST" && match) {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const key = idempotencyKey(request, body);
    if (key instanceof Response) return key;
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return json({ status: "validation_failed", message: "expectedRevision must be the recipe's current revision number." }, 422);
    }
    const outcome = await services.submissions.submitUpdate(submitter, {
      recipeId: decodeURIComponent(match[1]!),
      expectedRevision,
      changes: body.changes,
      idempotencyKey: key,
      note: typeof body.note === "string" ? body.note : null,
    });
    return json(outcome, statusCode(outcome));
  }

  match = path.match(/^\/submissions\/([^/]+)$/);
  if (method === "GET" && match) {
    const status = await services.submissions.statusFor(submitter, decodeURIComponent(match[1]!));
    return status ? json(status) : json({ status: "not_found", message: "No submission with that id from this credential." }, 404);
  }

  return json({ status: "not_found", message: "Unknown API route. See docs/integration.md." }, 404);
}
