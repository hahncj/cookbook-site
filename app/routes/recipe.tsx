import { Link, data } from "react-router";
import { jsonForScriptTag, toSchemaOrgRecipe } from "../../server/core/recipes";
import { BackIcon, EditIcon } from "../components/icons";
import { servicesContext } from "../context";
import { useRootData } from "../root";
import type { Route } from "./+types/recipe";

export async function loader({ params, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const entry = await services.catalog.get(params.id);
  if (!entry) throw data("Not found", { status: 404 });
  const pageUrl = `${services.config.baseUrl}/recipes/${entry.id}`;
  const schema = toSchemaOrgRecipe(entry, pageUrl);
  return { entry, schemaJson: schema ? jsonForScriptTag(schema) : null };
}

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  if (!loaded) return [{ title: "Not found · Cookbook" }];
  const tags = [{ title: `${loaded.entry.title} · Cookbook` }];
  if (loaded.entry.description) tags.push({ name: "description", content: loaded.entry.description } as never);
  return tags;
}

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function RecipePage({ loaderData }: Route.ComponentProps) {
  const { entry, schemaJson } = loaderData;
  const { viewer } = useRootData();
  const isIdea = entry.kind === "idea";
  const facts = [
    entry.yieldText,
    entry.prepTime && `Prep ${entry.prepTime}`,
    entry.cookTime && `Cook ${entry.cookTime}`,
  ].filter(Boolean) as string[];

  return (
    <article className="recipe">
      {schemaJson && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schemaJson }} />}

      <div className="recipe-top">
        <Link to="/" className="btn">
          <BackIcon />
          Cookbook
        </Link>
        {viewer?.isAdmin && (
          <Link to={`/recipes/${entry.id}/edit`} className="btn">
            <EditIcon />
            Edit
          </Link>
        )}
      </div>

      <header className="recipe-header">
        {(isIdea || entry.tags.length > 0) && (
          <p className="kicker">{isIdea ? "Idea" : entry.tags.map((tag) => tag.name).join(" · ")}</p>
        )}
        <h1 className={isIdea ? "idea" : undefined}>{entry.title}</h1>
        {entry.description && <p className="lede">{entry.description}</p>}
        {facts.length > 0 && (
          <p className="facts">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </p>
        )}
      </header>

      {entry.ingredients.length > 0 && (
        <section aria-labelledby="ingredients-heading">
          <h2 id="ingredients-heading" className="section-title">
            Ingredients
          </h2>
          <ul className="ingredients">
            {entry.ingredients.map((row, index) => (
              <li key={index}>
                <span className="qty">{row.quantity || <span className="muted">—</span>}</span>
                <span>{row.item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entry.steps.length > 0 && (
        <section aria-labelledby="method-heading">
          <h2 id="method-heading" className="section-title">
            Method
          </h2>
          <ol className="steps">
            {entry.steps.map((step, index) => (
              <li key={index}>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {isIdea && entry.ingredients.length === 0 && entry.steps.length === 0 && !entry.notes && (
        <p className="muted">Just an idea so far — no recipe yet.</p>
      )}

      {entry.notes && (
        <section aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="section-title">
            Notes
          </h2>
          <div className="notes-box">{entry.notes}</div>
        </section>
      )}

      {(entry.tags.length > 0 || entry.collections.length > 0) && (
        <section aria-label="Tags and collections" className="tag-links">
          {entry.collections.map((collection) => (
            <Link key={collection.id} to={`/?collection=${encodeURIComponent(collection.id)}`} className="chip">
              {collection.name}
            </Link>
          ))}
          {entry.tags.map((tag) => (
            <Link key={tag.id} to={`/?tag=${encodeURIComponent(tag.name)}`} className="chip">
              {tag.name}
            </Link>
          ))}
        </section>
      )}

      <footer className="source">
        {entry.sourceUrl && (
          <span>
            Source:{" "}
            <a href={entry.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
              {entry.sourceName || sourceLabel(entry.sourceUrl)}
            </a>
          </span>
        )}
        {!entry.sourceUrl && entry.sourceName && <span>Source: {entry.sourceName}</span>}
        <span>
          Added {formatDate(entry.createdAt)}
          {entry.revision > 1 && ` · updated ${formatDate(entry.updatedAt)}`}
        </span>
      </footer>
    </article>
  );
}
