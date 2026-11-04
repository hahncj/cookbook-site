import { useState } from "react";
import { Link } from "react-router";
import type { DuplicateMatch } from "../../server/core/duplicates";

interface Props {
  matches: DuplicateMatch[];
  aiEnabled: boolean;
  /** Current editor contents, read when "Check with AI" is pressed. */
  currentDraft: () => { title: string; ingredients: string[]; steps: string[] };
}

type Check = { state: "busy" } | { state: "done"; verdict: string; explanation: string } | { state: "error"; message: string };

const VERDICTS: Record<string, string> = {
  same: "Looks like the same recipe",
  variation: "A variation of the same dish",
  different: "A different recipe",
};

/**
 * Possible duplicates from free word matching (D8). Only a suggestion: it
 * never merges or deletes anything (AC-057). "Check with AI" runs only when pressed.
 */
export function DuplicateNotice({ matches, aiEnabled, currentDraft }: Props) {
  const [checks, setChecks] = useState<Record<string, Check>>({});
  if (matches.length === 0) return null;

  async function check(recipeId: string) {
    setChecks((c) => ({ ...c, [recipeId]: { state: "busy" } }));
    try {
      const response = await fetch("/api/ai/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId, draft: currentDraft() }),
      });
      const result = (await response.json().catch(() => ({}))) as { verdict?: string; explanation?: string; message?: string };
      setChecks((c) => ({
        ...c,
        [recipeId]:
          response.ok && result.verdict
            ? { state: "done", verdict: result.verdict, explanation: result.explanation ?? "" }
            : { state: "error", message: result.message ?? "The AI check failed. Try again." },
      }));
    } catch {
      setChecks((c) => ({ ...c, [recipeId]: { state: "error", message: "The AI check failed. Try again." } }));
    }
  }

  return (
    <div className="notice duplicate-notice" role="status">
      <strong>{matches.length === 1 ? "This may already be in the cookbook" : "These may already be in the cookbook"}</strong>
      <ul>
        {matches.map((match) => {
          const status = checks[match.id];
          return (
            <li key={match.id}>
              <Link to={`/recipes/${match.id}`} target="_blank" rel="noopener">
                {match.title}
              </Link>{" "}
              <span className="muted">({match.reasons.join("; ") || "similar title"})</span>
              {aiEnabled && (
                <>
                  {" "}
                  <button type="button" className="btn btn-small" onClick={() => check(match.id)} disabled={status?.state === "busy"}>
                    {status?.state === "busy" ? "Checking…" : "Check with AI"}
                  </button>
                </>
              )}
              {status?.state === "done" && (
                <p>
                  <strong>{VERDICTS[status.verdict] ?? status.verdict}.</strong> {status.explanation}
                </p>
              )}
              {status?.state === "error" && <p className="error-text">{status.message}</p>}
            </li>
          );
        })}
      </ul>
      <p className="hint">Nothing is merged or changed. Keep going if this is a different recipe.</p>
    </div>
  );
}
