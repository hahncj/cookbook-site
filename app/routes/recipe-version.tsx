import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Change } from "../../server/core/history";
import { ingredientLine } from "../../server/core/recipes";
import { requireAdminWrite } from "../admin.server";
import { BackIcon } from "../components/icons";
import { servicesContext } from "../context";
import { photoUrl } from "../photo-prepare";
import { useRootData } from "../root";
import { formatWhen, originLabel } from "./recipe-history";
import type { Route } from "./+types/recipe-version";

export async function loader({ params, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const revision = Number(params.revision);
  if (!Number.isInteger(revision) || revision < 1) throw data("Not found", { status: 404 });
  const detail = await services.catalog.revisionDetail(params.id, revision);
  if (!detail) throw data("Not found", { status: 404 });
  return {
    id: detail.entry.id,
    title: detail.entry.title,
    currentRevision: detail.entry.revision,
    version: detail.revision,
    changesFromPrevious: detail.changesFromPrevious,
    changesToCurrent: detail.changesToCurrent,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `Version ${loaderData.version.revision} · ${loaderData.title} · Cookbook` : "Version · Cookbook" }];
}

// POST: restore this version as a new version (admin only, with a conflict check).
export async function action({ request, params, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const admin = await requireAdminWrite(request, services);
  const form = await request.formData();
  const expected = Number(form.get("expectedRevision"));
  const result = await services.catalog.restoreRevision(params.id, Number(params.revision), expected, { userId: admin.userId });
  if (result.ok) return redirect(`/recipes/${params.id}?restored=${params.revision}`, 303);
  if (result.reason === "not_found") throw data("Not found", { status: 404 });
  return { error: "The recipe changed since you opened this page, so nothing was restored. Reload and try again." };
}

function ChangeList({ changes }: { changes: Change[] }) {
  if (changes.length === 0) return <p className="muted">No differences.</p>;
  return (
    <dl className="change-list">
      {changes.map((change) => (
        <div key={change.field + change.label}>
          <dt>{change.label}</dt>
          {change.type === "text" ? (
            <dd>
              {change.before && (
                <del>
                  <span className="visually-hidden">Removed: </span>
                  {change.before}
                </del>
              )}
              {change.after && (
                <ins>
                  <span className="visually-hidden">Added: </span>
                  {change.after}
                </ins>
              )}
            </dd>
          ) : (
            <dd>
              {change.removed.map((line, i) => (
                <del key={`r${i}`}>
                  <span aria-hidden="true">− </span>
                  <span className="visually-hidden">Removed: </span>
                  {line}
                </del>
              ))}
              {change.added.map((line, i) => (
                <ins key={`a${i}`}>
                  <span aria-hidden="true">+ </span>
                  <span className="visually-hidden">Added: </span>
                  {line}
                </ins>
              ))}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

export default function RecipeVersion({ loaderData, actionData }: Route.ComponentProps) {
  const { id, title, currentRevision, version, changesFromPrevious, changesToCurrent } = loaderData;
  const { viewer } = useRootData();
  const navigation = useNavigation();
  const restoring = navigation.state === "submitting";
  const snap = version.snapshot;
  const isCurrent = version.revision === currentRevision;

  return (
    <article className="recipe">
      <div className="recipe-top">
        <Link to={`/recipes/${id}/history`} className="btn">
          <BackIcon />
          History
        </Link>
      </div>

      <header className="recipe-header">
        <p className="kicker">
          Version {version.revision} of {title} · {originLabel(version)}
        </p>
        <h1 className={snap.kind === "idea" ? "idea" : undefined}>{snap.title}</h1>
        <p className="facts">
          <span>Saved {formatWhen(version.createdAt)}</span>
          {version.changeNote && version.changeNote !== originLabel(version) && <span>“{version.changeNote}”</span>}
        </p>
      </header>

      {isCurrent ? (
        <p className="notice">This is the current version.</p>
      ) : (
        viewer?.isAdmin && (
          <Form method="post" className="danger-zone">
            <input type="hidden" name="expectedRevision" value={currentRevision} />
            <p>
              <strong>Restore this version</strong>
              <br />
              <span className="muted">It becomes version {currentRevision + 1}. Versions in between are kept.</span>
            </p>
            <button type="submit" className="btn btn-primary" disabled={restoring}>
              {restoring ? "Restoring…" : "Restore this version"}
            </button>
          </Form>
        )
      )}
      {actionData?.error && (
        <p className="alert" role="alert">
          {actionData.error}
        </p>
      )}

      {changesFromPrevious && (
        <section aria-labelledby="changed-heading">
          <h2 id="changed-heading" className="section-title">
            What changed in this version
          </h2>
          <ChangeList changes={changesFromPrevious} />
        </section>
      )}

      {!isCurrent && (
        <section aria-labelledby="current-heading">
          <h2 id="current-heading" className="section-title">
            Differences from the current version
          </h2>
          <ChangeList changes={changesToCurrent} />
        </section>
      )}

      <section aria-labelledby="content-heading" className="version-content">
        <h2 id="content-heading" className="section-title">
          This version in full
        </h2>
        {snap.description && <p className="lede">{snap.description}</p>}
        {snap.photos.length > 0 && (
          <ul className="gallery">
            {snap.photos.map((photo, index) => (
              <li key={photo.id}>
                <img src={photoUrl(photo.id, "thumb")} alt={photo.caption || `Photo ${index + 1}`} loading="lazy" />
              </li>
            ))}
          </ul>
        )}
        {snap.ingredients.length > 0 && (
          <>
            <h3>Ingredients</h3>
            <ul className="ingredients">
              {snap.ingredients.map((row, index) => (
                <li key={index}>
                  <span className="qty">{row.quantity || "—"}</span>
                  <span>{row.item || ingredientLine(row)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {snap.steps.length > 0 && (
          <>
            <h3>Method</h3>
            <ol className="steps">
              {snap.steps.map((step, index) => (
                <li key={index}>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        {snap.notes && (
          <>
            <h3>Notes</h3>
            <div className="notes-box">{snap.notes}</div>
          </>
        )}
        {snap.tags.length > 0 && <p className="muted">Tags: {snap.tags.join(", ")}</p>}
      </section>
    </article>
  );
}
