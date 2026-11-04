import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import { MAX_IDENTIFY_IMAGES, gatherImages } from "../../server/ai-features";
import { AI_NOT_CONFIGURED } from "../../server/core/ai";
import type { Route } from "./+types/api.ai.ingredients";

// POST /api/ai/ingredients — multipart: `image` files (resized in the browser),
// `photoId` (saved photos), `description`. Admin only, checked before any AI
// call (AC-066/067). Returns suggestions; nothing is saved (AC-047).
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  await requireAdminWrite(request, services);
  if (!services.ai.configured) return Response.json({ message: AI_NOT_CONFIGURED }, { status: 503 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ message: "The request couldn't be read. Try again." }, { status: 400 });
  }
  const uploads = form.getAll("image").filter((f): f is File => f instanceof Blob);
  if (uploads.length > MAX_IDENTIFY_IMAGES) return Response.json({ message: `Use at most ${MAX_IDENTIFY_IMAGES} photos.` }, { status: 400 });
  const photoIds = form.getAll("photoId").map(String).slice(0, MAX_IDENTIFY_IMAGES);
  const description = String(form.get("description") ?? "").trim().slice(0, 4000) || null;
  const images = await gatherImages(services, await Promise.all(uploads.map(async (f) => new Uint8Array(await f.arrayBuffer()))), photoIds);
  if ("message" in images) return Response.json({ message: images.message }, { status: 400 });
  if (images.length === 0 && !description) return Response.json({ message: "Add a photo or describe the dish first." }, { status: 400 });
  const result = await services.ai.identifyIngredients({ images, description });
  if (!result.ok) return Response.json({ message: result.message }, { status: result.reason === "not_configured" ? 503 : 502 });
  return Response.json(result.value);
}
