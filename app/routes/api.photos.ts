import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import { storePhoto } from "../../server/photos";
import type { Route } from "./+types/api.photos";

// POST /api/photos — multipart with `full` and `thumb` image files (already
// resized in the browser). Admin only. Returns the stored photo's id and size.
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const admin = await requireAdminWrite(request, services);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ message: "Upload was not readable." }, { status: 400 });
  }
  const full = form.get("full");
  const thumb = form.get("thumb");
  if (!(full instanceof Blob) || !(thumb instanceof Blob)) {
    return Response.json({ message: "Both the photo and its thumbnail are required." }, { status: 400 });
  }
  const result = await storePhoto(
    { db: services.db, media: services.media, newId: () => crypto.randomUUID(), now: () => new Date() },
    { full: new Uint8Array(await full.arrayBuffer()), thumb: new Uint8Array(await thumb.arrayBuffer()) },
    { userId: admin.userId },
  );
  return result.ok ? Response.json(result.photo, { status: 201 }) : Response.json({ message: result.message }, { status: result.status });
}
