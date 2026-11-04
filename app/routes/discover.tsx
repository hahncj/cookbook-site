import { Form, Link, data, useNavigation } from "react-router";
import { requireAdminPage, requireAdminWrite } from "../admin.server";
import { servicesContext } from "../context";
import { AI_NOT_CONFIGURED } from "../../server/core/ai";
import type { Discoveries, WrittenDiscovery } from "../../server/core/discover";
import type { Route } from "./+types/discover";

// AI mode in the search bar (M7, workflow 5). Admin-only: the page and the
// request both check before any Claude call (AC-066/067). Results are new
// recipes only (from the web, or written by AI and labeled so). Nothing is
// saved from here: "Save to cookbook" opens the editor (D2).

type DiscoverData = { ok: true; result: Discoveries } | { ok: false; error: string; request: string };

export function meta() {
  return [{ title: "Find new recipes · 540 Kitchen" }];
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
  const asked = String(form.get("q") ?? "");
  const source = form.get("source") === "web" ? "web" : "write";
  if (!services.ai.configured) return data<DiscoverData>({ ok: false, error: AI_NOT_CONFIGURED, request: asked }, { status: 503 });
  const outcome = await services.discovery.discover({ request: asked, source });
  if (!outcome.ok) return data<DiscoverData>({ ok: false, error: outcome.message, request: asked }, { status: outcome.reason === "invalid" ? 422 : 502 });
  return data<DiscoverData>({ ok: true, result: outcome.value });
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function Discover({ loaderData, actionData }: Route.ComponentProps) {
  const answer = actionData as DiscoverData | undefined;
  const navigation = useNavigation();
  const finding = navigation.state === "submitting" && navigation.formAction === "/discover";
  const result = answer?.ok && !finding ? answer.result : null;
  const failed = answer && !answer.ok && !finding ? answer : null;

  return (
    <div className="form-page discover-page">
      <div className="form-head">
        <h1>Find new recipes</h1>
        <Link to="/preferences" className="btn">
          Preferences
        </Link>
      </div>
      {!loaderData.aiEnabled && (
        <div className="notice" role="status">
          {AI_NOT_CONFIGURED}
        </div>
      )}
      {!answer && !finding && (
        <p className="lede">
          In the search bar, choose <strong>AI</strong> for recipes Claude writes for you (quick), or <strong>Web</strong> for real recipes with sources
          (slower), then describe what you'd like to cook. Your <Link to="/preferences">preferences</Link> are used unless you add “ignore my
          preferences” to the request. It won't repeat recipes you already have. Nothing is saved unless you save it.
        </p>
      )}
      {failed && (
        <div className="alert" role="alert">
          <strong>No new recipes this time</strong>
          {failed.error}
        </div>
      )}
      {result && <Results result={result} />}
    </div>
  );
}

function Results({ result }: { result: Discoveries }) {
  const nothing = result.web.length === 0 && result.written.length === 0;
  return (
    <section className="discover-results" aria-labelledby="discover-results-title">
      <h2 id="discover-results-title" className="section-title">
        New recipes for “{result.request}”
      </h2>
      <p className="muted">
        {result.source === "web" ? "Found on the web" : "Written by AI"} ·{" "}
        {result.usedPreferences ? "your preferences were used (add “ignore my preferences” to leave them out)" : "preferences not used"}
      </p>
      {result.note && <p className="notice">{result.note}</p>}
      {nothing && <p className="empty">Nothing fit this time. Try asking a different way.</p>}
      <ol className="suggestions">
        {result.web.map((w) => (
          <li key={w.url} className="suggestion card">
            <span className="suggestion-label suggestion-web">From the web</span>
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
              {w.savedRecipeId ? (
                <Link to={`/recipes/${w.savedRecipeId}`} className="btn btn-small">
                  Already in your cookbook
                </Link>
              ) : (
                <Link to={`/recipes/import?url=${encodeURIComponent(w.url)}`} className="btn btn-small">
                  Save to cookbook…
                </Link>
              )}
            </div>
          </li>
        ))}
        {result.written.map((r) => (
          <WrittenCard key={r.title} recipe={r} />
        ))}
      </ol>
      {result.droppedUnverified > 0 && (
        <p className="muted">
          {result.droppedUnverified} web suggestion{result.droppedUnverified === 1 ? " was" : "s were"} left out because the link couldn't be confirmed.
        </p>
      )}
      <p className="muted">“Save to cookbook” opens the recipe in the editor so you can check it. Nothing is saved until you press Save.</p>
    </section>
  );
}

function WrittenCard({ recipe }: { recipe: WrittenDiscovery }) {
  const facts = [recipe.yieldText, recipe.prepTime && `Prep ${recipe.prepTime}`, recipe.cookTime && `Cook ${recipe.cookTime}`].filter(Boolean).join(" · ");
  return (
    <li className="suggestion card written-recipe">
      <span className="suggestion-label suggestion-written">Written by AI · untested</span>
      <h3 className="suggestion-title">{recipe.title}</h3>
      {recipe.reason && <p>{recipe.reason}</p>}
      {recipe.description && <p className="muted">{recipe.description}</p>}
      {facts && <p className="suggestion-source muted">{facts}</p>}
      <details>
        <summary>Show ingredients and steps</summary>
        <ul>
          {recipe.ingredients.map((i, n) => (
            <li key={n}>{[i.quantity, i.item].filter(Boolean).join(" ")}</li>
          ))}
        </ul>
        <ol>
          {recipe.steps.map((s, n) => (
            <li key={n}>{s}</li>
          ))}
        </ol>
        {recipe.notes && <p className="muted">{recipe.notes}</p>}
      </details>
      <Form method="post" action="/recipes/import">
        <input type="hidden" name="intent" value="written" />
        <input type="hidden" name="draft" value={JSON.stringify(recipe)} />
        <button type="submit" className="btn btn-small" aria-label={`Save to cookbook: ${recipe.title}`}>
          Save to cookbook…
        </button>
      </Form>
    </li>
  );
}
