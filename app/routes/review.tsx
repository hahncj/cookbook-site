import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { diffSnapshots, snapshotOf } from "../../server/core/history";
import { ingredientLine } from "../../server/core/recipes";
import type { Submission } from "../../server/core/submissions";
import { requireAdminPage, requireAdminWrite } from "../admin.server";
import { ChangeList } from "../components/change-list";
import { DuplicateNotice } from "../components/duplicate-notice";
import { FindPhoto, type FoundPhoto } from "../components/find-photo";
import { CloseIcon } from "../components/icons";
import { photoUrl } from "../photo-prepare";
import { servicesContext } from "../context";
import type { Route } from "./+types/review";

export function meta() {
  return [{ title: "Review AI submissions · 540 Kitchen" }];
}

function view(submission: Submission) {
  const proposed = snapshotOf(submission.proposed, []);
  return {
    id: submission.id,
    type: submission.type,
    status: submission.status,
    clientName: submission.clientName,
    note: submission.note,
    message: submission.message,
    createdAt: submission.createdAt,
    decidedAt: submission.decidedAt,
    targetRecipeId: submission.targetRecipeId,
    resultRecipeId: submission.resultRecipeId,
    title: proposed.title,
    proposed,
    changes: submission.baseSnapshot ? diffSnapshots({ ...submission.baseSnapshot, collections: [], photos: [] }, { ...proposed, photos: [] }) : null,
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  await requireAdminPage(request, services);
  const [pending, decided, approvalRequired] = await Promise.all([
    services.submissions.listPending(),
    services.submissions.listDecided(),
    services.submissions.approvalRequired(),
  ]);
  // Free duplicate check for new recipes from AI tools (D8); no AI involved.
  const views = await Promise.all(
    pending.map(async (submission) => {
      const item = view(submission);
      const duplicates =
        item.type === "create" ? await services.catalog.findSimilar({ title: item.title, ingredients: item.proposed.ingredients.map((i) => i.item) }) : [];
      return { ...item, duplicates };
    }),
  );
  return { pending: views, decided: decided.map(view), approvalRequired, aiEnabled: services.ai.configured };
}

export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const admin = await requireAdminWrite(request, services);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = form.get("intent");
  const actor = { userId: admin.userId };
  const photoIds = form.getAll("photoId").map(String);
  const result =
    intent === "approve"
      ? await services.submissions.approve(id, actor, { photoIds })
      : intent === "reject"
        ? await services.submissions.reject(id, actor)
        : null;
  if (!result) return { message: "That submission no longer exists." };
  if (intent === "approve" && result.status === "conflict") return { message: result.message ?? "It couldn't be applied because the recipe changed." };
  return { message: null };
}

function when(date: Date | string) {
  return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}

function Preview({ proposed }: { proposed: ReturnType<typeof view>["proposed"] }) {
  return (
    <details className="preview">
      <summary>Show the full {proposed.kind}</summary>
      {proposed.description && <p className="lede">{proposed.description}</p>}
      {proposed.yieldText && <p className="muted">{proposed.yieldText}</p>}
      {proposed.ingredients.length > 0 && (
        <ul className="ingredients">
          {proposed.ingredients.map((row, i) => (
            <li key={i}>
              <span className="qty">{row.quantity || "—"}</span>
              <span>{row.item || ingredientLine(row)}</span>
            </li>
          ))}
        </ul>
      )}
      {proposed.steps.length > 0 && (
        <ol className="steps">
          {proposed.steps.map((step, i) => (
            <li key={i}>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
      {proposed.notes && <div className="notes-box">{proposed.notes}</div>}
      {proposed.tags.length > 0 && <p className="muted">Tags: {proposed.tags.join(", ")}</p>}
    </details>
  );
}

/** Find a photo (E1) for a new entry that arrived without one. Saved only on approval. */
function ReviewPhoto({ item }: { item: { id: string; title: string; proposed: { sourceUrl: string | null; sourceName: string | null } } }) {
  const [photo, setPhoto] = useState<FoundPhoto | null>(null);
  if (photo) {
    return (
      <div className="review-photo">
        <input type="hidden" name="photoId" value={photo.id} />
        <img src={photoUrl(photo.id, "thumb")} alt={`Chosen photo for ${item.title}`} width={96} height={96} />
        <div>
          <p className="hint" style={{ margin: 0 }}>Added when you approve.</p>
          {photo.credit && <p className="photo-credit">{photo.credit}</p>}
          <button type="button" className="btn" onClick={() => setPhoto(null)} style={{ marginTop: 6 }}>
            <CloseIcon />
            Remove photo
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="photo-buttons review-find-photo">
      <FindPhoto
        query={() => ({ title: item.title, sourceUrl: item.proposed.sourceUrl ?? "", sourceName: item.proposed.sourceName ?? "" })}
        onAdded={setPhoto}
      />
    </div>
  );
}

export default function Review({ loaderData, actionData }: Route.ComponentProps) {
  const { pending, decided, approvalRequired, aiEnabled } = loaderData;
  const navigation = useNavigation();
  const busyId = navigation.state === "submitting" ? navigation.formData?.get("id") : null;

  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      <h1>Review AI submissions</h1>
      <p className="muted">
        From your connected AI tools. {approvalRequired ? "Nothing changes in the cookbook until you approve." : "Approval is off: new submissions save right away."}{" "}
        <Link to="/settings">{approvalRequired ? "Approval is on" : "Turn approval on"}</Link>
      </p>
      {actionData?.message && (
        <p className="alert" role="alert">
          {actionData.message}
        </p>
      )}

      {pending.length === 0 ? (
        <p className="notice">Nothing waiting for review.</p>
      ) : (
        pending.map((item) => (
          <article key={item.id} className="review-card" aria-labelledby={`sub-${item.id}`}>
            <header>
              <p className="kicker">
                {item.type === "create" ? "New" : "Update"} · from {item.clientName} · {when(item.createdAt)}
              </p>
              <h2 id={`sub-${item.id}`}>
                {item.type === "update" && item.targetRecipeId ? <Link to={`/recipes/${item.targetRecipeId}`}>{item.title}</Link> : item.title}
              </h2>
              {item.note && <p className="version-note">“{item.note}”</p>}
            </header>

            {item.status === "conflict" ? (
              <p className="alert">{item.message}</p>
            ) : item.changes ? (
              <ChangeList changes={item.changes} />
            ) : (
              <Preview proposed={item.proposed} />
            )}
            {item.changes && <Preview proposed={item.proposed} />}
            <DuplicateNotice
              matches={item.duplicates}
              aiEnabled={aiEnabled}
              currentDraft={() => ({
                title: item.proposed.title,
                ingredients: item.proposed.ingredients.map((i) => i.item),
                steps: item.proposed.steps,
              })}
            />

            <Form method="post">
              {item.status === "pending" && item.type === "create" && item.proposed.photos.length === 0 && <ReviewPhoto item={item} />}
              <div className="review-actions">
              <input type="hidden" name="id" value={item.id} />
              {item.status === "pending" && (
                <button type="submit" name="intent" value="approve" className="btn btn-primary" disabled={busyId === item.id}>
                  Approve &amp; apply
                </button>
              )}
              <button type="submit" name="intent" value="reject" className="btn" disabled={busyId === item.id}>
                {item.status === "conflict" ? "Dismiss" : "Reject"}
              </button>
              </div>
            </Form>
          </article>
        ))
      )}

      {decided.length > 0 && (
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="section-title">
            Recently decided
          </h2>
          <ul className="trash-list">
            {decided.map((item) => (
              <li key={item.id}>
                <span>
                  {item.status === "applied" && item.resultRecipeId ? <Link to={`/recipes/${item.resultRecipeId}`}>{item.title}</Link> : item.title}
                  <span className="muted"> · {item.clientName}</span>
                </span>
                <span className="muted">
                  {item.status === "applied" ? "Applied" : "Rejected"}
                  {item.decidedAt ? ` · ${when(item.decidedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
