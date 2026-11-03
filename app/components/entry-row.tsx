import { Link } from "react-router";
import type { EntrySummary } from "../../server/core/recipes";
import { IdeaIcon } from "./icons";

function metaLine(entry: EntrySummary): string {
  const parts: string[] = [];
  if (entry.kind === "idea") parts.push(entry.ingredientPreview.length ? "Rough idea" : "No recipe yet");
  if (entry.prepTime || entry.cookTime) parts.push([entry.prepTime, entry.cookTime].filter(Boolean).join(" + "));
  if (entry.yieldText) parts.push(entry.yieldText);
  if (entry.tags.length) parts.push(entry.tags.slice(0, 3).join(", "));
  return parts.join(" · ");
}

/** One catalog row. Photos arrive in M3; until then recipes show an ingredient snippet. */
export function EntryRow({ entry }: { entry: EntrySummary }) {
  const isIdea = entry.kind === "idea";
  const meta = metaLine(entry);
  return (
    <li>
      <Link to={`/recipes/${entry.id}`} className="entry-link">
        <div className="entry-body">
          {isIdea && (
            <span className="kicker">
              <IdeaIcon width={13} height={13} />
              Idea
            </span>
          )}
          <h2 className={isIdea ? "entry-title idea" : "entry-title"}>{entry.title}</h2>
          {meta && <p className="entry-meta">{meta}</p>}
        </div>
        {!isIdea && entry.ingredientPreview.length > 0 && (
          <div className="snippet" aria-hidden="true">
            {entry.ingredientPreview.join(", ")}…
          </div>
        )}
      </Link>
    </li>
  );
}
