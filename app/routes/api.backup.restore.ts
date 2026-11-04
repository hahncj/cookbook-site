import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import { BACKUP_FORMAT, BACKUP_VERSION, MAX_ROWS_PER_CHUNK, TABLE_ORDER, catalogContainedIn, importRows, isCatalogEmpty } from "../../server/backup";
import type { Route } from "./+types/api.backup.restore";

// POST /api/backup/restore — JSON steps, admin only:
//   { step: "begin", format, version, ids } → refuses unless the cookbook is empty
//                                        (or holds only this backup's items: a resumed restore)
//   { step: "rows", table, rows }        → inserts one validated chunk
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  await requireAdminWrite(request, services);
  let body: { step?: unknown; format?: unknown; version?: unknown; table?: unknown; rows?: unknown; ids?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Expected JSON." }, { status: 400 });
  }
  if (body.step === "begin") {
    if (body.format !== BACKUP_FORMAT || body.version !== BACKUP_VERSION) {
      return Response.json({ message: "This file isn't a cookbook backup this version can read." }, { status: 400 });
    }
    const resumable = await catalogContainedIn(services.db, body.ids ?? {});
    if (!(await isCatalogEmpty(services.db)) && !resumable) {
      return Response.json({ message: "Restore only works into an empty cookbook, so it can never overwrite recipes." }, { status: 409 });
    }
    return Response.json({ ok: true, tableOrder: TABLE_ORDER, chunkSize: MAX_ROWS_PER_CHUNK });
  }
  if (body.step === "rows" && typeof body.table === "string") {
    const result = await importRows(services.db, body.table, body.rows);
    return result.ok ? Response.json(result) : Response.json({ message: result.message }, { status: 400 });
  }
  return Response.json({ message: "Unknown restore step." }, { status: 400 });
}
