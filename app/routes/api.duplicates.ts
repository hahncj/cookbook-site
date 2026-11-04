import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import type { Route } from "./+types/api.duplicates";

// POST /api/duplicates — JSON {title, ingredients: string[], excludeId?}.
// Free word-overlap check (D8); no AI. Admin only (used by the editor).
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  await requireAdminWrite(request, services);
  const body = (await request.json().catch(() => null)) as { title?: unknown; ingredients?: unknown; excludeId?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.slice(0, 200) : "";
  const ingredients = Array.isArray(body?.ingredients) ? body.ingredients.filter((i): i is string => typeof i === "string").slice(0, 200) : [];
  const matches = await services.catalog.findSimilar(
    { title, ingredients },
    { excludeId: typeof body?.excludeId === "string" ? body.excludeId : null },
  );
  return Response.json({ matches });
}
