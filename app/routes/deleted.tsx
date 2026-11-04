import { Form, Link, redirect, useNavigation } from "react-router";
import { requireAdminPage, requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import type { Route } from "./+types/deleted";

export function meta() {
  return [{ title: "Deleted recipes · 540 Kitchen" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  await requireAdminPage(request, services);
  const url = new URL(request.url);
  return { entries: await services.catalog.listDeleted(), removed: url.searchParams.has("removed") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const admin = await requireAdminWrite(request, services);
  const id = String((await request.formData()).get("id") ?? "");
  const restored = await services.catalog.restore(id, { userId: admin.userId });
  return restored ? redirect(`/recipes/${id}`, 303) : redirect("/deleted", 303);
}

function formatDate(date: Date | string | null) {
  return date ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
}

export default function DeletedRecipes({ loaderData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const restoringId = navigation.state === "submitting" ? navigation.formData?.get("id") : null;
  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      <h1>Deleted recipes</h1>
      {loaderData.removed && (
        <p className="notice" role="status">
          Recipe deleted. Restore it below if that was a mistake.
        </p>
      )}
      <p className="muted">Deleted recipes are hidden from everyone but kept, so you can bring them back anytime.</p>
      {loaderData.entries.length === 0 ? (
        <p>Nothing here.</p>
      ) : (
        <ul className="trash-list">
          {loaderData.entries.map((entry) => (
            <li key={entry.id}>
              <div>
                <p style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600 }}>{entry.title}</p>
                <p className="muted" style={{ fontSize: 14 }}>
                  {entry.kind === "idea" ? "Idea" : "Recipe"} · deleted {formatDate(entry.deletedAt)}
                </p>
              </div>
              <Form method="post">
                <input type="hidden" name="id" value={entry.id} />
                <button type="submit" className="btn" disabled={restoringId === entry.id}>
                  {restoringId === entry.id ? "Restoring…" : "Restore"}
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link to="/">Back to the cookbook</Link>
      </p>
    </div>
  );
}
