import { Form, data, redirect, useNavigation } from "react-router";
import { requireAdminPage, requireAdminWrite } from "../admin.server";
import { EntryForm } from "../components/entry-form";
import { servicesContext } from "../context";
import { entryToFormValues, saveEntryAction, withPhotoCredits, type EntryActionData } from "../entry-form.server";
import { writtenToDraft } from "../../server/ai-features";
import type { Route } from "./+types/recipe-edit";

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  return [{ title: loaded ? `Edit ${loaded.values.title} · 540 Kitchen` : "Edit · 540 Kitchen" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  await requireAdminPage(request, services);
  const entry = await services.catalog.get(params.id);
  if (!entry) throw data("Not found", { status: 404 });
  return {
    id: entry.id,
    values: { ...entryToFormValues(entry), photos: await withPhotoCredits(services, entry.photos) },
    collections: await services.catalog.listCollections(),
    aiEnabled: services.ai.configured,
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  if (request.headers.get("Content-Type")?.includes("form")) {
    const intent = (await request.clone().formData()).get("intent");
    if (intent === "revised") {
      // "Edit this recipe with these changes" from AI help (D20): fills the
      // editor only. Saving makes a new version, so the old one stays in history.
      await requireAdminWrite(request, services);
      const form = await request.formData();
      const entry = await services.catalog.get(params.id);
      if (!entry) throw data("Not found", { status: 404 });
      const draft = writtenToDraft(String(form.get("draft") ?? ""));
      if (!draft) throw data("That change couldn't be opened. Ask AI help again.", { status: 422 });
      let changes: string[] = [];
      try {
        const parsed = JSON.parse(String(form.get("changes") ?? "[]"));
        if (Array.isArray(parsed)) changes = parsed.filter((c): c is string => typeof c === "string").slice(0, 10).map((c) => c.slice(0, 300));
      } catch {
        changes = [];
      }
      const asked = String(form.get("request") ?? "").replace(/\s+/g, " ").trim();
      const values = {
        ...entryToFormValues(entry),
        photos: await withPhotoCredits(services, entry.photos),
        title: draft.title,
        description: draft.description ?? "",
        yieldText: draft.yieldText ?? "",
        prepTime: draft.prepTime ?? "",
        cookTime: draft.cookTime ?? "",
        ingredients: draft.ingredients,
        steps: draft.steps.join("\n"),
        notes: draft.notes ?? entry.notes ?? "",
        changeNote: `AI change: ${asked}`.slice(0, 200),
      };
      return data<EntryActionData & { aiChanges: string[] }>({ errors: {}, values, aiChanges: changes });
    }
    if (intent === "delete") {
      const admin = await requireAdminWrite(request, services);
      await services.catalog.remove(params.id, { userId: admin.userId });
      return redirect("/deleted?removed=1", 303);
    }
  }
  return saveEntryAction(request, services, { id: params.id });
}

export default function EditRecipe({ loaderData, actionData }: Route.ComponentProps) {
  const aiChanges = actionData && "aiChanges" in actionData ? (actionData.aiChanges as string[]) : null;
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting" && navigation.formData?.get("intent") === "delete";
  return (
    <>
      <EntryForm
        key={actionData ? JSON.stringify(actionData.values) : "initial"}
        heading={`Edit ${loaderData.values.kind === "idea" ? "idea" : "recipe"}`}
        editing
        cancelTo={`/recipes/${loaderData.id}`}
        values={actionData?.values ?? loaderData.values}
        errors={actionData?.errors}
        collections={loaderData.collections}
        aiEnabled={loaderData.aiEnabled}
        banner={
          aiChanges ? (
            <div className="notice import-banner" role="status">
              <strong>Changed by AI. Check everything before saving.</strong>
              Saving makes a new version; the current one stays in the history.
              {aiChanges.length > 0 && (
                <ul>
                  {aiChanges.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : undefined
        }
      />
      <Form
        method="post"
        className="form-page"
        style={{ marginTop: 32 }}
        onSubmit={(event) => {
          if (!window.confirm("Delete this recipe? You can restore it later from Deleted recipes.")) event.preventDefault();
        }}
      >
        <div className="danger-zone">
          <p>
            <strong>Delete</strong>
            <br />
            <span className="muted">It disappears from the cookbook but can be restored from Deleted recipes.</span>
          </p>
          <button type="submit" name="intent" value="delete" className="btn btn-danger" disabled={deleting}>
            {deleting ? "Deleting…" : "Delete recipe"}
          </button>
        </div>
      </Form>
    </>
  );
}
