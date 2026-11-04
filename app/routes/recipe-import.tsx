import { useState } from "react";
import { Form, Link, data, useNavigation, useSubmit } from "react-router";
import { requireAdminPage, requireAdminWrite } from "../admin.server";
import { EntryForm } from "../components/entry-form";
import { servicesContext } from "../context";
import { draftToFormValues, saveEntryAction, type EntryActionData, type EntryFormValues } from "../entry-form.server";
import { preparePhoto, uploadPhoto } from "../photo-prepare";
import { importFromImage, importFromLink, importFromText, type ImportOutcome } from "../../server/ai-features";
import { AI_NOT_CONFIGURED } from "../../server/core/ai";
import type { DuplicateMatch } from "../../server/core/duplicates";
import type { Route } from "./+types/recipe-import";

type Tab = "paste" | "link" | "photo";

type ImportActionData =
  | { stage: "input"; tab: Tab; error: string; text: string; url: string }
  | {
      stage: "review";
      values: EntryFormValues;
      uncertain: string[];
      otherRecipes: number;
      method: "structured" | "ai";
      duplicates: DuplicateMatch[];
    }
  | (EntryActionData & { stage?: undefined });

export function meta() {
  return [{ title: "Import a recipe · 540 Kitchen" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  await requireAdminPage(request, services);
  return { collections: await services.catalog.listCollections(), aiEnabled: services.ai.configured };
}

export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const form = await request.clone().formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "paste" && intent !== "link" && intent !== "photo") {
    // The reviewed draft is being saved: the owner's Save is the approval (D2).
    return saveEntryAction(request, services, null);
  }

  // Admin check comes before any fetch or AI call (AC-066/067).
  await requireAdminWrite(request, services);
  const text = String(form.get("text") ?? "");
  const url = String(form.get("url") ?? "");
  let outcome: ImportOutcome;
  if (intent === "paste") outcome = await importFromText(services, text);
  else if (intent === "link") outcome = await importFromLink(services, url);
  else {
    const file = form.get("image");
    outcome =
      file instanceof Blob ? await importFromImage(services, new Uint8Array(await file.arrayBuffer())) : { ok: false, message: "Choose a photo first." };
  }

  if (!outcome.ok) {
    // Keep what was entered so nothing has to be retyped (AC-048), and never fill in made-up details (AC-033).
    return data<ImportActionData>({ stage: "input", tab: intent, error: outcome.message, text, url }, { status: 422 });
  }
  const values = draftToFormValues(outcome.draft, outcome.origin);
  const keepPhotoId = String(form.get("keepPhotoId") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(keepPhotoId)) values.photos = [{ id: keepPhotoId, caption: "" }];
  return data<ImportActionData>({
    stage: "review",
    values,
    uncertain: outcome.draft.uncertain,
    otherRecipes: outcome.draft.otherRecipes,
    method: outcome.method,
    duplicates: outcome.duplicates,
  });
}

const TAB_LABELS: Record<Tab, string> = { paste: "Paste text", link: "Web link", photo: "Photo" };

export default function ImportRecipe({ loaderData, actionData }: Route.ComponentProps) {
  const result = actionData as ImportActionData | undefined;
  const navigation = useNavigation();
  const submit = useSubmit();
  const working = navigation.state === "submitting" && ["paste", "link", "photo"].includes(String(navigation.formData?.get("intent")));
  const [tab, setTab] = useState<Tab>(result?.stage === "input" ? result.tab : "paste");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  if (result && result.stage !== "input") {
    const review = result.stage === "review" ? result : null;
    return (
      <EntryForm
        key={JSON.stringify(result.values)}
        heading="Review the import"
        cancelTo="/recipes/import"
        values={result.values}
        errors={"errors" in result ? result.errors : undefined}
        collections={loaderData.collections}
        aiEnabled={loaderData.aiEnabled}
        duplicates={review?.duplicates}
        checkDuplicates
        banner={
          review && (
            <div className="notice import-banner" role="status">
              <strong>Check everything before saving.</strong>
              {review.method === "structured"
                ? "Read from the page's own recipe data."
                : "Extracted by AI. Missing details were left blank rather than guessed."}
              {review.otherRecipes > 0 && (
                <p>
                  The source had {review.otherRecipes} more recipe{review.otherRecipes === 1 ? "" : "s"}. Only the first was imported; import the
                  others one at a time.
                </p>
              )}
              {review.uncertain.length > 0 && (
                <>
                  <p>Please double-check:</p>
                  <ul>
                    {review.uncertain.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )
        }
      />
    );
  }

  const failed = result?.stage === "input" ? result : null;

  async function submitPhoto(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhotoError(null);
    const form = new FormData(event.currentTarget);
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0) {
      setPhotoError("Choose a photo first.");
      return;
    }
    setPreparing(true);
    try {
      const body = new FormData();
      body.set("intent", "photo");
      body.set("image", (await preparePhoto(file)).full, "photo.jpg");
      if (form.get("keep") === "on") body.set("keepPhotoId", (await uploadPhoto(file)).id);
      submit(body, { method: "post", encType: "multipart/form-data" });
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "The photo couldn't be prepared.");
    } finally {
      setPreparing(false);
    }
  }

  const busyLabel = (label: string) => (working ? "Reading…" : label);

  return (
    <div className="form-page">
      <div className="form-head">
        <h1>Import a recipe</h1>
        <Link to="/recipes/new" className="btn">
          Type it in instead
        </Link>
      </div>
      <p className="lede">Bring in one recipe at a time. You'll review it in the editor before anything is saved.</p>

      {!loaderData.aiEnabled && (
        <div className="notice" role="status">
          {AI_NOT_CONFIGURED} Web links that include recipe data can still be imported.
        </div>
      )}

      <div className="segmented" role="group" aria-label="Import from">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {failed && failed.tab === tab && (
        <div className="alert" role="alert">
          <strong>Import didn't work</strong>
          {failed.error}
        </div>
      )}

      {tab === "paste" && (
        <Form method="post" className="import-panel">
          <div className="field">
            <label htmlFor="import-text">Recipe text</label>
            <p className="hint" id="import-text-hint">
              Paste the full recipe from an old chat, an email or a note. Extra chat text is fine.
            </p>
            <textarea id="import-text" name="text" rows={12} defaultValue={failed?.text ?? ""} aria-describedby="import-text-hint" required />
          </div>
          <button type="submit" name="intent" value="paste" className="btn btn-primary" disabled={working || !loaderData.aiEnabled}>
            {busyLabel("Read recipe")}
          </button>
        </Form>
      )}

      {tab === "link" && (
        <Form method="post" className="import-panel">
          <div className="field">
            <label htmlFor="import-url">Web address</label>
            <input id="import-url" name="url" type="url" inputMode="url" placeholder="https://" defaultValue={failed?.url ?? ""} required />
          </div>
          <button type="submit" name="intent" value="link" className="btn btn-primary" disabled={working}>
            {busyLabel("Read page")}
          </button>
        </Form>
      )}

      {tab === "photo" && (
        <form className="import-panel" onSubmit={submitPhoto}>
          <div className="field">
            <label htmlFor="import-photo">Photo or screenshot of a recipe</label>
            <p className="hint" id="import-photo-hint">
              A recipe card, a cookbook page, or a screenshot. It needs to be readable.
            </p>
            <input id="import-photo" name="photo" type="file" accept="image/*" aria-describedby="import-photo-hint" />
          </div>
          <label className="check">
            <input type="checkbox" name="keep" />
            Also add this photo to the recipe
          </label>
          {photoError && (
            <p className="error-text" role="alert">
              {photoError}
            </p>
          )}
          <div>
            <button type="submit" className="btn btn-primary" disabled={working || preparing || !loaderData.aiEnabled}>
              {preparing ? "Preparing photo…" : busyLabel("Read photo")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
