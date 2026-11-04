import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import type { Route } from "./+types/api.photos.find";

// POST /api/photos/find — form: `title`, `sourceUrl`, `sourceName`, `more`.
// Find a photo (E1): candidates from the recipe's source page and stock
// photos, or the web when those find nothing or `more` is set. Admin only,
// checked before any fetch or search. Nothing is saved (D2).
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  await requireAdminWrite(request, services);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ message: "The request couldn't be read. Try again." }, { status: 400 });
  }
  const field = (name: string) => String(form.get(name) ?? "").slice(0, 2_000);
  const result = await services.photoFinder.find({
    title: field("title"),
    sourceUrl: field("sourceUrl") || null,
    sourceName: field("sourceName") || null,
    more: form.get("more") === "1",
  });
  return Response.json(result);
}
