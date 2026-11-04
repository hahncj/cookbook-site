import { requireAdminPage } from "../admin.server";
import { EntryForm } from "../components/entry-form";
import { servicesContext } from "../context";
import { emptyFormValues, saveEntryAction } from "../entry-form.server";
import type { Route } from "./+types/recipe-new";

export function meta() {
  return [{ title: "Add a recipe · 540 Kitchen" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  await requireAdminPage(request, services);
  const kind = new URL(request.url).searchParams.get("kind") === "idea" ? "idea" : "recipe";
  return { values: emptyFormValues(kind), collections: await services.catalog.listCollections() };
}

export async function action({ request, context }: Route.ActionArgs) {
  return saveEntryAction(request, context.get(servicesContext), null);
}

export default function NewRecipe({ loaderData, actionData }: Route.ComponentProps) {
  const values = actionData?.values ?? loaderData.values;
  return (
    <EntryForm
      key={actionData ? JSON.stringify(actionData.values) : "initial"}
      heading={values.kind === "idea" ? "New idea" : "New recipe"}
      cancelTo="/"
      values={values}
      errors={actionData?.errors}
      collections={loaderData.collections}
    />
  );
}
