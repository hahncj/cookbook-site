import { Link, data } from "react-router";
import type { RevisionInfo } from "../../server/core/history";
import { BackIcon } from "../components/icons";
import { servicesContext } from "../context";
import type { Route } from "./+types/recipe-history";

export async function loader({ params, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const entry = await services.catalog.get(params.id);
  if (!entry) throw data("Not found", { status: 404 });
  const versions = await services.catalog.history(entry.id);
  return { id: entry.id, title: entry.title, current: entry.revision, versions };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `History · ${loaderData.title} · Cookbook` : "History · Cookbook" }];
}

export function originLabel(version: Pick<RevisionInfo, "origin" | "restoredFrom">): string {
  switch (version.origin) {
    case "create":
      return "Created";
    case "edit":
      return "Edited";
    case "restore":
      return `Restored version ${version.restoredFrom}`;
    case "ai":
      return "Changed by an AI tool";
    case "backfill":
      return "Saved before history began";
  }
}

export function formatWhen(date: Date | string) {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export default function RecipeHistory({ loaderData }: Route.ComponentProps) {
  const { id, title, current, versions } = loaderData;
  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      <Link to={`/recipes/${id}`} className="btn" style={{ alignSelf: "flex-start" }}>
        <BackIcon />
        {title}
      </Link>
      <h1>Version history</h1>
      <p className="muted">Every save keeps a full copy. Restoring an older version adds a new version, so nothing is ever lost.</p>
      <ol className="version-list" reversed>
        {versions.map((version) => (
          <li key={version.revision}>
            <Link to={`/recipes/${id}/history/${version.revision}`} className="version-link">
              <span className="version-number">Version {version.revision}</span>
              <span>
                {originLabel(version)}
                {version.revision === current && <span className="badge">Current</span>}
              </span>
              <span className="muted">{formatWhen(version.createdAt)}</span>
              {version.changeNote && version.changeNote !== originLabel(version) && (
                <span className="version-note">“{version.changeNote}”</span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
