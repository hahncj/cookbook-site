import { Form, Link, data, useNavigation } from "react-router";
import { requireAdminPage, requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import { AI_NOT_CONFIGURED } from "../../server/core/ai";
import { QUESTION_MAX, type Recommendations } from "../../server/core/recommendations";
import type { Route } from "./+types/ask";

// "Ask AI for suggestions" (M7, workflow 5). Admin-only: the page and the
// request both check before any Claude call (AC-066/067). Results are
// suggestions only; nothing is saved from here (D2).

type AskData = { ok: true; result: Recommendations } | { ok: false; error: string; question: string; includeWeb: boolean };

export function meta() {
  return [{ title: "Ask AI · 540 Kitchen" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  await requireAdminPage(request, services);
  return { aiEnabled: services.ai.configured };
}

export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  // Access first, before reading anything else or calling Claude.
  await requireAdminWrite(request, services);
  const form = await request.formData();
  const question = String(form.get("question") ?? "");
  const includeWeb = form.get("web") === "on";
  if (!services.ai.configured) return data<AskData>({ ok: false, error: AI_NOT_CONFIGURED, question, includeWeb }, { status: 503 });
  const outcome = await services.recommender.ask({ question, includeWeb });
  if (!outcome.ok) {
    const status = outcome.reason === "invalid" || outcome.reason === "empty_catalog" ? 422 : 502;
    return data<AskData>({ ok: false, error: outcome.message, question, includeWeb }, { status });
  }
  return data<AskData>({ ok: true, result: outcome.value });
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function Ask({ loaderData, actionData }: Route.ComponentProps) {
  const answer = actionData as AskData | undefined;
  const navigation = useNavigation();
  const asking = navigation.state === "submitting" && navigation.formMethod?.toLowerCase() === "post";
  const failed = answer && !answer.ok ? answer : null;
  const result = answer?.ok ? answer.result : null;
  const lastQuestion = failed?.question ?? (result && result.question !== "What should I cook next?" ? result.question : "");
  const lastWeb = failed?.includeWeb ?? result?.includeWeb ?? true;

  return (
    <div className="form-page ask-page">
      <div className="form-head">
        <h1>Ask AI</h1>
        <Link to="/preferences" className="btn">
          Preferences
        </Link>
      </div>
      <p className="lede">Get suggestions from your saved recipes, and new ideas from the web if you like. Nothing is saved unless you save it.</p>

      {!loaderData.aiEnabled && (
        <div className="notice" role="status">
          {AI_NOT_CONFIGURED}
        </div>
      )}

      <Form method="post" className="ask-form">
        <div className="field">
          <label htmlFor="ask-question">What are you looking for?</label>
          <p className="hint" id="ask-question-hint">
            For example “something quick tonight” or “a vegetable side for the chili”. This applies to this question only; to make something
            permanent, add it on <Link to="/preferences">Preferences</Link>.
          </p>
          <textarea
            id="ask-question"
            name="question"
            rows={3}
            maxLength={QUESTION_MAX}
            placeholder="What should I cook tonight?"
            defaultValue={lastQuestion}
            aria-describedby="ask-question-hint"
          />
        </div>
        <label className="check">
          <input type="checkbox" name="web" defaultChecked={lastWeb} />
          Also look for new recipes on the web
        </label>
        <div>
          <button type="submit" className="btn btn-primary" disabled={asking || !loaderData.aiEnabled}>
            {asking ? "Thinking…" : "Get suggestions"}
          </button>
        </div>
        {asking && (
          <p className="muted" role="status">
            Looking through your recipes{lastWeb ? " and the web" : ""}. This can take up to a minute.
          </p>
        )}
      </Form>

      {failed && (
        <div className="alert" role="alert">
          <strong>No suggestions this time</strong>
          {failed.error}
        </div>
      )}

      {result && !asking && <Results result={result} />}
    </div>
  );
}

function Results({ result }: { result: Recommendations }) {
  const nothing = result.saved.length === 0 && result.web.length === 0;
  return (
    <section className="ask-results" aria-labelledby="ask-results-title">
      <h2 id="ask-results-title" className="section-title">
        Suggestions
      </h2>
      {result.note && <p className="notice">{result.note}</p>}
      {nothing && <p className="empty">No good matches this time. Try asking a different way{result.includeWeb ? "" : ", or include the web"}.</p>}
      <ol className="suggestions">
        {result.saved.map((s) => (
          <li key={s.recipeId} className="suggestion card">
            <span className="suggestion-label suggestion-saved">Saved recipe</span>
            <h3 className="suggestion-title">
              <Link to={`/recipes/${s.recipeId}`}>{s.title}</Link>
            </h3>
            {s.reason && <p>{s.reason}</p>}
            {s.feedback && (
              <p className="suggestion-feedback muted">
                {[s.feedback.favorite && "Favorite", s.feedback.wantToTry && "Want to try", s.feedback.madeCount > 0 && `Made ${s.feedback.madeCount}×`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </li>
        ))}
        {result.web.map((w) => (
          <li key={w.url} className="suggestion card">
            <span className="suggestion-label suggestion-web">Web discovery</span>
            <h3 className="suggestion-title">
              <a href={w.url} target="_blank" rel="noopener noreferrer">
                {w.title}
                <span className="visually-hidden"> (opens the source page in a new tab)</span>
              </a>
            </h3>
            {w.reason && <p>{w.reason}</p>}
            <p className="suggestion-source muted">
              Source: {w.sourceName}
              {w.sourceName !== hostOf(w.url) && ` (${hostOf(w.url)})`} · {w.pageRead ? "Page read by AI" : "Seen in search results only"}
            </p>
            <div>
              <Link to={`/recipes/import?url=${encodeURIComponent(w.url)}`} className="btn btn-small">
                Save to cookbook…
              </Link>
            </div>
          </li>
        ))}
      </ol>
      {result.droppedUnverified > 0 && (
        <p className="muted">
          {result.droppedUnverified} web suggestion{result.droppedUnverified === 1 ? " was" : "s were"} left out because the link couldn't be confirmed.
        </p>
      )}
      {result.web.length > 0 && (
        <p className="muted">Web discoveries are not in your cookbook. “Save to cookbook” opens the page in the import editor; nothing is saved until you press Save.</p>
      )}
    </section>
  );
}
