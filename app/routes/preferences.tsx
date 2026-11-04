import { useState } from "react";
import { Form, Link, data, useNavigation } from "react-router";
import { requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import { useRootData } from "../root";
import { shortDate } from "../components/markers";
import { AI_NOT_CONFIGURED } from "../../server/core/ai";
import { STATEMENT_MAX, type Preference } from "../../server/core/preferences";
import type { Route } from "./+types/preferences";

// The preference profile (M7, workflow 6). Everyone can read it (D3). Only
// admins refresh it (an AI call, on request only, D9) or correct it.
// Corrections survive refreshes and rejected items don't come back
// (AC-017, AC-035). The profile only affects AI mode in the search bar.

type ActionData = { ok: true; message: string } | { ok: false; error: string; intent: string; id?: string };

export function meta() {
  return [{ title: "Preferences · 540 Kitchen" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const view = await services.preferences.view();
  const all = [...view.confirmed, ...view.suggested, ...view.rejected];
  const titles = await services.catalog.titles(all.flatMap((p) => p.evidence));
  return { ...view, titles: Object.fromEntries(titles), aiEnabled: services.ai.configured };
}

export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  // Access first, before reading the form or calling Claude (AC-066/067).
  const admin = await requireAdminWrite(request, services);
  const actor = { userId: admin.userId };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const p = services.preferences;
  const fail = (error: string, status = 422) => data<ActionData>({ ok: false, error, intent, id }, { status });
  const notFound = () => fail("That preference wasn't found. Reload the page.", 404);

  switch (intent) {
    case "refresh": {
      if (!services.ai.configured) return fail(AI_NOT_CONFIGURED, 503);
      const result = await p.refresh(actor);
      if (!result.ok) return fail(result.message, result.reason === "empty_catalog" ? 422 : 502);
      const message =
        result.added === 0
          ? "Refreshed. No new suggestions this time."
          : `Refreshed. ${result.added} suggestion${result.added === 1 ? "" : "s"} to review.`;
      return data<ActionData>({ ok: true, message });
    }
    case "confirm":
      return (await p.confirm(id, actor)) === "ok" ? data<ActionData>({ ok: true, message: "Marked as right." }) : notFound();
    case "reject":
      return (await p.reject(id, actor)) === "ok" ? data<ActionData>({ ok: true, message: "Removed. It won't be suggested again." }) : notFound();
    case "forget":
      return (await p.forget(id)) === "ok" ? data<ActionData>({ ok: true, message: "It may be suggested again on the next refresh." }) : notFound();
    case "edit": {
      const result = await p.edit(id, form.get("statement"), actor);
      if (result === "invalid") return fail(`Write the preference in ${STATEMENT_MAX} characters or fewer.`);
      return result === "ok" ? data<ActionData>({ ok: true, message: "Saved your correction." }) : notFound();
    }
    case "add": {
      const result = await p.add(form.get("statement"), actor);
      if (result === "invalid") return fail(`Write the preference in ${STATEMENT_MAX} characters or fewer.`);
      return data<ActionData>({ ok: true, message: "Added." });
    }
    default:
      return fail("Unknown action.", 400);
  }
}

export default function PreferencesPage({ loaderData, actionData }: Route.ComponentProps) {
  const { viewer } = useRootData();
  const isAdmin = Boolean(viewer?.isAdmin);
  const result = actionData as ActionData | undefined;
  const navigation = useNavigation();
  const refreshing = navigation.state === "submitting" && navigation.formData?.get("intent") === "refresh";
  const { confirmed, suggested, rejected, lastRefresh, titles } = loaderData;
  const empty = confirmed.length === 0 && suggested.length === 0 && rejected.length === 0;

  return (
    <div className="form-page preferences-page">
      <div className="form-head">
        <h1>Preferences</h1>
      </div>
      <p className="lede">
        What the AI has learned about how this kitchen likes to cook, with the recipes behind each guess. It's only used when an admin finds new recipes with AI mode in the search bar.
      </p>

      {isAdmin && (
        <div className="prefs-refresh card">
          <p className="muted">
            {lastRefresh
              ? `Last refreshed ${shortDate(new Date(lastRefresh.createdAt))} from ${lastRefresh.recipeCount} recipe${lastRefresh.recipeCount === 1 ? "" : "s"}.`
              : "Not refreshed yet."}{" "}
            Refreshing replaces only the suggestions you haven't reviewed. Your corrections are kept.
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="refresh" />
            <button type="submit" className="btn btn-primary" disabled={refreshing || !loaderData.aiEnabled}>
              {refreshing ? "Refreshing…" : "Refresh from my recipes"}
            </button>
          </Form>
          {!loaderData.aiEnabled && <p className="muted">{AI_NOT_CONFIGURED}</p>}
        </div>
      )}

      {result && result.ok && (
        <p className="notice" role="status">
          {result.message}
        </p>
      )}
      {result && !result.ok && (
        <div className="alert" role="alert">
          {result.error}
        </div>
      )}
      {lastRefresh?.note && <p className="notice">{lastRefresh.note}</p>}

      {empty && <p className="empty">No preferences yet.{isAdmin ? " Refresh to have AI suggest some, or add your own below." : ""}</p>}

      <PreferenceSection
        title="Confirmed"
        hint="Confirmed or written by the cooks. These always count."
        items={confirmed}
        titles={titles}
        isAdmin={isAdmin}
        actionData={result}
      />
      <PreferenceSection
        title="Suggested by AI"
        hint="Not reviewed yet. They count as hints until you confirm, correct or remove them."
        items={suggested}
        titles={titles}
        isAdmin={isAdmin}
        actionData={result}
      />
      <PreferenceSection
        title="Not true"
        hint="Rejected suggestions. A refresh won't bring them back."
        items={rejected}
        titles={titles}
        isAdmin={isAdmin}
        actionData={result}
      />

      {isAdmin && (
        <Form method="post" className="prefs-add card">
          <input type="hidden" name="intent" value="add" />
          <div className="field">
            <label htmlFor="pref-add">Add your own</label>
            <p className="hint" id="pref-add-hint">
              For example “We like dinners that take under 45 minutes”.
            </p>
            <input id="pref-add" name="statement" className="input" maxLength={STATEMENT_MAX} required aria-describedby="pref-add-hint" />
          </div>
          <div>
            <button type="submit" className="btn">
              Add preference
            </button>
          </div>
        </Form>
      )}
    </div>
  );
}

function PreferenceSection({
  title,
  hint,
  items,
  titles,
  isAdmin,
  actionData,
}: {
  title: string;
  hint: string;
  items: Preference[];
  titles: Record<string, string>;
  isAdmin: boolean;
  actionData: ActionData | undefined;
}) {
  if (items.length === 0) return null;
  const headingId = `prefs-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title">
        {title}
      </h2>
      <p className="muted">{hint}</p>
      <ul className="prefs-list">
        {items.map((item) => (
          <PreferenceItem key={item.id} item={item} titles={titles} isAdmin={isAdmin} actionData={actionData} />
        ))}
      </ul>
    </section>
  );
}

function PreferenceItem({
  item,
  titles,
  isAdmin,
  actionData,
}: {
  item: Preference;
  titles: Record<string, string>;
  isAdmin: boolean;
  actionData: ActionData | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const evidence = item.evidence.filter((id) => titles[id]);
  const error = actionData && !actionData.ok && actionData.id === item.id ? actionData.error : null;
  const hidden = (intent: string) => (
    <>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={item.id} />
    </>
  );
  return (
    <li className="pref card" data-pref-id={item.id} data-status={item.status}>
      <p className="pref-statement">{item.statement}</p>
      <p className="pref-meta muted">
        {item.source === "owner" ? "Added by a cook" : item.status === "suggested" ? `AI guess · ${item.confidence ?? "low"} confidence` : "From an AI suggestion"}
        {item.inferredStatement && item.inferredStatement !== item.statement && ` · AI first said: “${item.inferredStatement}”`}
      </p>
      {evidence.length > 0 && (
        <p className="pref-evidence">
          Based on:{" "}
          {evidence.map((id, index) => (
            <span key={id}>
              {index > 0 && ", "}
              <Link to={`/recipes/${id}`}>{titles[id]}</Link>
            </span>
          ))}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {isAdmin && editing && (
        <Form method="post" className="pref-edit" onSubmit={() => setEditing(false)}>
          {hidden("edit")}
          <label className="visually-hidden" htmlFor={`pref-edit-${item.id}`}>
            Corrected preference
          </label>
          <input id={`pref-edit-${item.id}`} name="statement" className="input" defaultValue={item.statement} maxLength={STATEMENT_MAX} required />
          <div className="review-actions">
            <button type="submit" className="btn btn-primary btn-small">
              Save correction
            </button>
            <button type="button" className="btn btn-small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </Form>
      )}
      {isAdmin && !editing && (
        <div className="review-actions">
          {item.status === "suggested" && (
            <Form method="post">
              {hidden("confirm")}
              <button type="submit" className="btn btn-small" aria-label={`That's right: ${item.statement}`}>
                That's right
              </button>
            </Form>
          )}
          {item.status !== "rejected" && (
            <button type="button" className="btn btn-small" onClick={() => setEditing(true)} aria-label={`Correct: ${item.statement}`}>
              Correct it
            </button>
          )}
          {item.status !== "rejected" && (
            <Form method="post">
              {hidden("reject")}
              <button type="submit" className="btn btn-small" aria-label={`${item.source === "owner" ? "Delete" : "Not true"}: ${item.statement}`}>
                {item.source === "owner" ? "Delete" : "Not true"}
              </button>
            </Form>
          )}
          {item.status === "rejected" && (
            <Form method="post">
              {hidden("forget")}
              <button type="submit" className="btn btn-small" aria-label={`Allow again: ${item.statement}`}>
                Allow again
              </button>
            </Form>
          )}
        </div>
      )}
    </li>
  );
}
