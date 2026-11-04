import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import type { Route } from "./+types/api.photos.fetch";

// POST /api/photos/fetch — form: `url` of a chosen Find a photo candidate (E1).
// Returns the image bytes so the browser can resize them like an upload
// (app/photo-prepare.ts); other sites' images can't be read by the page
// directly. Admin only, checked before any download; the download uses the
// SSRF-guarded fetcher. Nothing is stored here.
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  await requireAdminWrite(request, services);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ message: "The request couldn't be read. Try again." }, { status: 400 });
  }
  const url = String(form.get("url") ?? "").slice(0, 4_000);
  if (!url) return Response.json({ message: "No photo was chosen." }, { status: 400 });
  const result = await services.fetchImage(url);
  if (!result.ok) return Response.json({ message: result.message }, { status: 502 });
  return new Response(result.bytes, {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
