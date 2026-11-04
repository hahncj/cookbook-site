import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import { AI_NOT_CONFIGURED } from "../../server/core/ai";
import type { Route } from "./+types/api.ai.recipe-help";

// POST /api/ai/recipe-help — JSON {recipeId, mode: "substitute", ingredient, have}
// or {recipeId, mode: "change", request}. "AI help" on a saved recipe (D20).
// Admin only, checked before any AI call (AC-066/067). Returns suggestions;
// nothing is saved here (D2).
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  await requireAdminWrite(request, services);
  if (!services.ai.configured) return Response.json({ message: AI_NOT_CONFIGURED }, { status: 503 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const recipeId = typeof body?.recipeId === "string" ? body.recipeId : "";
  const outcome =
    body?.mode === "substitute"
      ? await services.recipeHelp.substitute(recipeId, { ingredient: body.ingredient, have: body.have })
      : body?.mode === "change"
        ? await services.recipeHelp.revise(recipeId, { request: body.request })
        : ({ ok: false, reason: "invalid", message: "Unknown request." } as const);
  if (!outcome.ok) {
    const status = outcome.reason === "not_found" ? 404 : outcome.reason === "invalid" ? 400 : outcome.reason === "not_configured" ? 503 : 502;
    return Response.json({ message: outcome.message }, { status });
  }
  return Response.json(outcome.value);
}
