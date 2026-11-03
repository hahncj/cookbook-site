import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import { exportBackupData } from "../../server/backup";
import type { Route } from "./+types/api.backup";

// GET /api/backup — all catalog data as JSON (admin only). The browser adds
// the photo files and builds the zip.
export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  await requireAdminWrite(request, services);
  const data = await exportBackupData(services.db, new Date());
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
