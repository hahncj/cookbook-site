import { Form, data, redirect, useNavigation } from "react-router";
import { requireAdminPage, requireAdminWrite } from "../admin.server";
import { EntryForm } from "../components/entry-form";
import { servicesContext } from "../context";
import { entryToFormValues, saveEntryAction, withPhotoCredits } from "../entry-form.server";
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
    if (intent === "delete") {
      const admin = await requireAdminWrite(request, services);
      await services.catalog.remove(params.id, { userId: admin.userId });
      return redirect("/deleted?removed=1", 303);
    }
  }
  return saveEntryAction(request, services, { id: params.id });
}

export default function EditRecipe({ loaderData, actionData }: Route.ComponentProps) {
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
