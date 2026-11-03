import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import { importPhotoFile } from "../../server/backup";
import type { Route } from "./+types/api.backup.photo";

// POST /api/backup/photo?key=photos/<id>.jpg — one photo file from a backup
// (raw bytes). Admin only; the photo's row must already be restored.
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  await requireAdminWrite(request, services);
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const body = new Uint8Array(await request.arrayBuffer());
  const result = await importPhotoFile(services.db, services.media, key, body);
  return result.ok ? Response.json(result) : Response.json({ message: result.message }, { status: 400 });
}
