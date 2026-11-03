import { Form, Link, data, useNavigation } from "react-router";
import { jsonForScriptTag, toSchemaOrgRecipe } from "../../server/core/recipes";
import { requireAdminWrite } from "../admin.server";
import { BackIcon, EditIcon, HistoryIcon } from "../components/icons";
import { servicesContext } from "../context";
import { photoUrl } from "../photo-prepare";
import { useRootData } from "../root";
import type { Route } from "./+types/recipe";

export async function loader({ params, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const entry = await services.catalog.get(params.id);
  if (!entry) throw data("Not found", { status: 404 });
  const pageUrl = `${services.config.baseUrl}/recipes/${entry.id}`;
  const schema = toSchemaOrgRecipe(entry, pageUrl);
  if (schema && entry.photos.length > 0) {
    schema.image = entry.photos.map((photo) => `${services.config.baseUrl}${photoUrl(photo.id)}`);
  }
  const notes = await services.catalog.listNotes(entry.id);
  return { entry, notes, schemaJson: schema ? jsonForScriptTag(schema) : null };
}

// POST: add a dated "notes & experiments" entry (admin only; not a new version).
export async function action({ request, params, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const admin = await requireAdminWrite(request, services);
  const form = await request.formData();
  const body = String(form.get("note") ?? "");
  const result = await services.catalog.addNote(params.id, body, { userId: admin.userId });
  if (result === "not_found") throw data("Not found", { status: 404 });
  if (result === "ok") return { noteError: null, noteDraft: "" };
  return {
    noteError: result === "empty" ? "Write something first." : "Keep notes under 2,000 characters.",
    noteDraft: body,
  };
}

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  if (!loaded) return [{ title: "Not found · Cookbook" }];
  const tags = [{ title: `${loaded.entry.title} · Cookbook` }];
  if (loaded.entry.description) tags.push({ name: "description", content: loaded.entry.description } as never);
  return tags;
}

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function RecipePage({ loaderData, actionData }: Route.ComponentProps) {
  const { entry, notes, schemaJson } = loaderData;
  const { viewer } = useRootData();
  const navigation = useNavigation();
  const addingNote = navigation.state === "submitting" && navigation.formData?.has("note");
  const [cover, ...gallery] = entry.photos;
  const isIdea = entry.kind === "idea";
  const facts = [
    entry.yieldText,
    entry.prepTime && `Prep ${entry.prepTime}`,
    entry.cookTime && `Cook ${entry.cookTime}`,
  ].filter(Boolean) as string[];

  return (
    <article className="recipe">
      {schemaJson && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schemaJson }} />}

      <div className="recipe-top">
        <Link to="/" className="btn">
          <BackIcon />
          Cookbook
        </Link>
        {viewer?.isAdmin && (
          <Link to={`/recipes/${entry.id}/edit`} className="btn">
            <EditIcon />
            Edit
          </Link>
        )}
      </div>

      {cover && (
        <figure className="recipe-cover">
          <img src={photoUrl(cover.id)} alt={cover.caption || `Photo of ${entry.title}`} />
          {cover.caption && <figcaption>{cover.caption}</figcaption>}
        </figure>
      )}

      <header className="recipe-header">
        {(isIdea || entry.tags.length > 0) && (
          <p className="kicker">{isIdea ? "Idea" : entry.tags.map((tag) => tag.name).join(" · ")}</p>
        )}
        <h1 className={isIdea ? "idea" : undefined}>{entry.title}</h1>
        {entry.description && <p className="lede">{entry.description}</p>}
        {facts.length > 0 && (
          <p className="facts">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </p>
        )}
      </header>

      {entry.ingredients.length > 0 && (
        <section aria-labelledby="ingredients-heading">
          <h2 id="ingredients-heading" className="section-title">
            Ingredients
          </h2>
          <ul className="ingredients">
            {entry.ingredients.map((row, index) => (
              <li key={index}>
                <span className="qty">{row.quantity || <span className="muted">—</span>}</span>
                <span>{row.item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entry.steps.length > 0 && (
        <section aria-labelledby="method-heading">
          <h2 id="method-heading" className="section-title">
            Method
          </h2>
          <ol className="steps">
            {entry.steps.map((step, index) => (
              <li key={index}>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {isIdea && entry.ingredients.length === 0 && entry.steps.length === 0 && !entry.notes && (
        <p className="muted">Just an idea so far — no recipe yet.</p>
      )}

      {entry.notes && (
        <section aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="section-title">
            Notes
          </h2>
          <div className="notes-box">{entry.notes}</div>
        </section>
      )}

      {gallery.length > 0 && (
        <section aria-labelledby="photos-heading">
          <h2 id="photos-heading" className="section-title">
            More photos
          </h2>
          <ul className="gallery">
            {gallery.map((photo, index) => (
              <li key={photo.id}>
                <figure>
                  <a href={photoUrl(photo.id)} target="_blank" rel="noopener">
                    <img src={photoUrl(photo.id, "thumb")} alt={photo.caption || `Photo ${index + 2} of ${entry.title}`} loading="lazy" />
                  </a>
                  {photo.caption && <figcaption>{photo.caption}</figcaption>}
                </figure>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(notes.length > 0 || viewer?.isAdmin) && (
        <section aria-labelledby="experiments-heading" className="experiments">
          <h2 id="experiments-heading" className="section-title">
            Notes &amp; experiments
          </h2>
          {notes.length > 0 && (
            <ul className="experiment-list">
              {notes.map((note) => (
                <li key={note.id}>
                  <time dateTime={new Date(note.createdAt).toISOString()}>{formatDate(note.createdAt)}</time>
                  <p>{note.body}</p>
                </li>
              ))}
            </ul>
          )}
          {viewer?.isAdmin && (
            <Form method="post" className="note-form" preventScrollReset key={notes.length}>
              <label htmlFor="note" className="visually-hidden">
                Add a note about an experiment or change
              </label>
              <textarea
                id="note"
                name="note"
                rows={2}
                maxLength={2000}
                defaultValue={actionData?.noteDraft ?? ""}
                placeholder="What did you try? How did it turn out?"
                aria-invalid={actionData?.noteError ? true : undefined}
                aria-describedby={actionData?.noteError ? "note-error" : undefined}
              />
              {actionData?.noteError && (
                <p id="note-error" className="error-text">
                  {actionData.noteError}
                </p>
              )}
              <button type="submit" className="btn" disabled={addingNote}>
                {addingNote ? "Adding…" : "Add note"}
              </button>
            </Form>
          )}
        </section>
      )}

      {(entry.tags.length > 0 || entry.collections.length > 0) && (
        <section aria-label="Tags and collections" className="tag-links">
          {entry.collections.map((collection) => (
            <Link key={collection.id} to={`/?collection=${encodeURIComponent(collection.id)}`} className="chip">
              {collection.name}
            </Link>
          ))}
          {entry.tags.map((tag) => (
            <Link key={tag.id} to={`/?tag=${encodeURIComponent(tag.name)}`} className="chip">
              {tag.name}
            </Link>
          ))}
        </section>
      )}

      <footer className="source">
        {entry.sourceUrl && (
          <span>
            Source:{" "}
            <a href={entry.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
              {entry.sourceName || sourceLabel(entry.sourceUrl)}
            </a>
          </span>
        )}
        {!entry.sourceUrl && entry.sourceName && <span>Source: {entry.sourceName}</span>}
        <span>
          Added {formatDate(entry.createdAt)}
          {entry.revision > 1 && ` · updated ${formatDate(entry.updatedAt)}`}
        </span>
        <Link to={`/recipes/${entry.id}/history`} className="history-link">
          <HistoryIcon />
          Version {entry.revision} · View history
        </Link>
      </footer>
    </article>
  );
}
