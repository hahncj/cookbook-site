import { useId, useState } from "react";
import { Form, useFetcher } from "react-router";
import type { SubstituteOption } from "../../server/core/ai";

// "AI help" on a saved recipe (admins only, D20): swaps for a missing
// ingredient, and changing the recipe. Runs only when asked. Nothing is saved
// from here: a swap can be kept as a dated note, and a change opens the
// editor (a new version) or becomes a new recipe; the owner's Save is the
// approval (D2).

type Tab = "substitute" | "change";

interface Revised {
  request: string;
  recipe: {
    title: string;
    description: string;
    yieldText: string | null;
    prepTime: string;
    cookTime: string;
    ingredients: { quantity: string; item: string }[];
    steps: string[];
    notes: string;
  };
  changes: string[];
  message: string | null;
}

const blankToNull = (value: string) => (value.trim() ? value.trim() : null);

/** The shape the editor routes accept (server/ai-features.ts writtenToDraft). */
function draftJson(r: Revised["recipe"]) {
  return JSON.stringify({
    title: r.title,
    description: blankToNull(r.description),
    yieldText: r.yieldText,
    prepTime: blankToNull(r.prepTime),
    cookTime: blankToNull(r.cookTime),
    ingredients: r.ingredients,
    steps: r.steps,
    notes: blankToNull(r.notes),
  });
}

async function ask<T>(body: Record<string, unknown>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    const response = await fetch("/api/ai/recipe-help", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) return { ok: false, message: result.message ?? "AI help didn't work. Try again." };
    return { ok: true, value: result };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check the connection and try again." };
  }
}

export function RecipeHelp({ recipeId, ingredients, aiEnabled }: { recipeId: string; ingredients: string[]; aiEnabled: boolean }) {
  const id = useId();
  const [tab, setTab] = useState<Tab>(ingredients.length > 0 ? "substitute" : "change");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ingredient, setIngredient] = useState(ingredients[0] ?? "");
  const [have, setHave] = useState("");
  const [swaps, setSwaps] = useState<{ ingredient: string; options: SubstituteOption[]; message: string | null } | null>(null);

  const [request, setRequest] = useState("");
  const [revised, setRevised] = useState<Revised | null>(null);

  async function suggestSwaps() {
    setError(null);
    setSwaps(null);
    setBusy(true);
    const result = await ask<{ ingredient: string; options: SubstituteOption[]; message: string | null }>({ recipeId, mode: "substitute", ingredient, have });
    setBusy(false);
    if (result.ok) setSwaps(result.value);
    else setError(result.message);
  }

  async function suggestChange() {
    setError(null);
    setRevised(null);
    if (!request.trim()) {
      setError("Say how you'd like to change the recipe.");
      return;
    }
    setBusy(true);
    const result = await ask<Revised>({ recipeId, mode: "change", request });
    setBusy(false);
    if (result.ok) setRevised(result.value);
    else setError(result.message);
  }

  return (
    <section aria-labelledby={`${id}-title`} className="recipe-help card">
      <h2 id={`${id}-title`} className="section-title">
        AI help
      </h2>
      {!aiEnabled ? (
        <p className="muted">AI features aren't set up yet (no Anthropic API key).</p>
      ) : (
        <>
          <div className="segmented" role="group" aria-label="AI help with">
            {ingredients.length > 0 && (
              <button type="button" aria-pressed={tab === "substitute"} onClick={() => (setTab("substitute"), setError(null))}>
                Missing an ingredient
              </button>
            )}
            <button type="button" aria-pressed={tab === "change"} onClick={() => (setTab("change"), setError(null))}>
              Change this recipe
            </button>
          </div>

          {tab === "substitute" && (
            <div className="recipe-help-panel">
              <div className="field">
                <label htmlFor={`${id}-ingredient`}>Ingredient you're missing</label>
                <select id={`${id}-ingredient`} className="input" value={ingredient} onChange={(e) => setIngredient(e.target.value)}>
                  {ingredients.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${id}-have`}>
                  What do you have? <span className="optional">(optional)</span>
                </label>
                <input id={`${id}-have`} className="input" value={have} maxLength={200} onChange={(e) => setHave(e.target.value)} placeholder="e.g. sour cream, lemons" />
              </div>
              <div>
                <button type="button" className="btn btn-primary" onClick={suggestSwaps} disabled={busy}>
                  {busy ? "Thinking…" : "Suggest swaps"}
                </button>
              </div>
              {swaps && <Swaps recipeId={recipeId} result={swaps} />}
            </div>
          )}

          {tab === "change" && (
            <div className="recipe-help-panel">
              <div className="field">
                <label htmlFor={`${id}-request`}>How should it change?</label>
                <textarea
                  id={`${id}-request`}
                  rows={2}
                  maxLength={500}
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  placeholder="e.g. make it vegetarian, halve it, use the air fryer"
                />
              </div>
              <div>
                <button type="button" className="btn btn-primary" onClick={suggestChange} disabled={busy}>
                  {busy ? "Thinking…" : "Suggest changes"}
                </button>
              </div>
              {revised && <Change recipeId={recipeId} result={revised} />}
            </div>
          )}

          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Swaps({ recipeId, result }: { recipeId: string; result: { ingredient: string; options: SubstituteOption[]; message: string | null } }) {
  return (
    <div className="recipe-help-result" role="status">
      <p className="muted">AI suggestions for {result.ingredient}. Amounts are a starting point.</p>
      {result.message && <p>{result.message}</p>}
      {result.options.length === 0 && !result.message && <p>No good swaps found.</p>}
      <ul className="swap-list">
        {result.options.map((option) => (
          <SwapOption key={option.use} recipeId={recipeId} ingredient={result.ingredient} option={option} />
        ))}
      </ul>
    </div>
  );
}

function SwapOption({ recipeId, ingredient, option }: { recipeId: string; ingredient: string; option: SubstituteOption }) {
  const fetcher = useFetcher<{ noteError?: string | null }>();
  const saved = fetcher.state === "idle" && fetcher.data && !fetcher.data.noteError;
  const note = [`AI swap idea for ${ingredient}: ${option.use}${option.amount ? ` (${option.amount})` : ""}.`, option.how].filter(Boolean).join(" ");
  return (
    <li className="swap">
      <p>
        <strong>{option.use}</strong>
        {option.amount && ` · ${option.amount}`}
      </p>
      {option.how && <p>{option.how}</p>}
      {option.effect && <p className="muted">{option.effect}</p>}
      {saved ? (
        <p className="muted">Saved to Notes &amp; experiments.</p>
      ) : (
        <fetcher.Form method="post" action={`/recipes/${recipeId}`} preventScrollReset>
          <input type="hidden" name="note" value={note.slice(0, 2000)} />
          <button type="submit" className="btn btn-small" disabled={fetcher.state !== "idle"} aria-label={`Save as a note: ${option.use}`}>
            Save as a note
          </button>
        </fetcher.Form>
      )}
    </li>
  );
}

function Change({ recipeId, result }: { recipeId: string; result: Revised }) {
  const draft = draftJson(result.recipe);
  return (
    <div className="recipe-help-result" role="status">
      <p className="suggestion-label suggestion-written">Changed by AI · untested</p>
      {result.message && <p>{result.message}</p>}
      {result.changes.length > 0 && (
        <>
          <p>What changed:</p>
          <ul>
            {result.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </>
      )}
      <details>
        <summary>Show the changed recipe</summary>
        <p>
          <strong>{result.recipe.title}</strong>
          {result.recipe.yieldText && ` · ${result.recipe.yieldText}`}
        </p>
        <ul>
          {result.recipe.ingredients.map((i, n) => (
            <li key={n}>{[i.quantity, i.item].filter(Boolean).join(" ")}</li>
          ))}
        </ul>
        <ol>
          {result.recipe.steps.map((s, n) => (
            <li key={n}>{s}</li>
          ))}
        </ol>
      </details>
      <div className="review-actions">
        <Form method="post" action={`/recipes/${recipeId}/edit`}>
          <input type="hidden" name="intent" value="revised" />
          <input type="hidden" name="draft" value={draft} />
          <input type="hidden" name="changes" value={JSON.stringify(result.changes)} />
          <input type="hidden" name="request" value={result.request} />
          <button type="submit" className="btn btn-small">
            Edit this recipe with these changes…
          </button>
        </Form>
        <Form method="post" action="/recipes/import">
          <input type="hidden" name="intent" value="written" />
          <input type="hidden" name="draft" value={draft} />
          <button type="submit" className="btn btn-small">
            Save as a new recipe…
          </button>
        </Form>
      </div>
      <p className="muted">Both open the editor. Nothing is saved until you press Save.</p>
    </div>
  );
}
