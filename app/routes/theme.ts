import { redirect } from "react-router";
import { isTheme, safeReturnPath, themeCookie } from "../theme";
import type { Route } from "./+types/theme";

// POST /theme — saves the viewer's appearance choice for this device and
// returns to the page they were on. Works without JavaScript.
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const theme = form.get("theme");
  const back = safeReturnPath(form.get("returnTo"));
  if (!isTheme(theme)) return redirect(back, 303);
  const secure = new URL(request.url).protocol === "https:";
  return redirect(back, { status: 303, headers: { "Set-Cookie": themeCookie(theme, secure) } });
}

export function loader() {
  return redirect("/");
}
