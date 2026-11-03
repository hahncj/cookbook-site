import type { Services } from "../server/app";
import { isAdminEmail } from "../server/core/admin";

export interface Viewer {
  email: string;
  name: string;
  isAdmin: boolean;
}

/** Returns the signed-in viewer, re-checking the admin allow-list on every request (D5). */
export async function getViewer(request: Request, services: Services): Promise<Viewer | null> {
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return {
    email: session.user.email,
    name: session.user.name,
    isAdmin: isAdminEmail(session.user.email, services.config.adminEmails),
  };
}
