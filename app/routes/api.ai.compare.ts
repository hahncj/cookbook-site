import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import { recipeText } from "../../server/ai-features";
import { AI_NOT_CONFIGURED } from "../../server/core/ai";
import type { Route } from "./+types/api.ai.compare";

// POST /api/ai/compare — JSON {recipeId, draft:{title, ingredients, steps}}.
// "Check with AI" for a possible duplicate (D8): runs only on request, admin
// only, and never merges or changes anything (AC-057).
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  await requireAdminWrite(request, services);
  if (!services.ai.configured) return Response.json({ message: AI_NOT_CONFIGURED }, { status: 503 });
  const body = (await request.json().catch(() => null)) as {
    recipeId?: unknown;
    draft?: { title?: unknown; ingredients?: unknown; steps?: unknown };
  } | null;
  const existing = typeof body?.recipeId === "string" ? await services.catalog.get(body.recipeId) : null;
  if (!existing) return Response.json({ message: "That recipe wasn't found." }, { status: 404 });
  const draft = body?.draft ?? {};
  const title = typeof draft.title === "string" ? draft.title : "";
  const ingredients = Array.isArray(draft.ingredients)
    ? draft.ingredients.filter((i): i is string => typeof i === "string").slice(0, 200).map((item) => ({ quantity: "", item }))
    : [];
  const steps = Array.isArray(draft.steps) ? draft.steps.filter((s): s is string => typeof s === "string").slice(0, 200) : [];
  if (!title.trim()) return Response.json({ message: "Add a title first." }, { status: 400 });
  const result = await services.ai.compareRecipes(recipeText({ title, ingredients, steps }), recipeText(existing));
  if (!result.ok) return Response.json({ message: result.message }, { status: 502 });
  return Response.json(result.value);
}
