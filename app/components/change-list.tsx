import type { Change } from "../../server/core/history";

/** Removed/added lines for "what changed" views (history and the review queue). */
export function ChangeList({ changes }: { changes: Change[] }) {
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
