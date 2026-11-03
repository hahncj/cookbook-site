import { redirect } from "react-router";
import type { Services } from "../server/app";
import { getViewer, type Viewer } from "./session.server";

export type Admin = Viewer & { isAdmin: true };

/**
 * For admin PAGES (GET): signed-out visitors go to sign-in and come back.
 * Signed-in non-admins get 403.
 */
export async function requireAdminPage(request: Request, services: Services): Promise<Admin> {
  const viewer = await getViewer(request, services);
  if (viewer?.isAdmin) return viewer as Admin;
  if (viewer) throw new Response("Only cookbook admins can do that.", { status: 403 });
  const url = new URL(request.url);
  throw redirect(`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);
}

/**
 * For WRITES (actions): enforced on the server regardless of what the page
 * showed (AC-064). Signed out → 401, signed in but not an admin → 403.
 */
export async function requireAdminWrite(request: Request, services: Services): Promise<Admin> {
  const viewer = await getViewer(request, services);
  if (viewer?.isAdmin) return viewer as Admin;
  throw new Response(viewer ? "Only cookbook admins can do that." : "Sign in as a cookbook admin to do that.", {
    status: viewer ? 403 : 401,
  });
}
