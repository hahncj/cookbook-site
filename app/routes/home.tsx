import { Link, useSearchParams } from "react-router";
import { EntryRow } from "../components/entry-row";
import { PlusIcon } from "../components/icons";
import { servicesContext } from "../context";
import { useRootData } from "../root";
import type { Route } from "./+types/home";

export function meta({ loaderData: data }: Route.MetaArgs) {
  const q = data?.filters.q;
  return [{ title: q ? `“${q}” · Cookbook` : "Cookbook" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const url = new URL(request.url);
  const filters = {
    q: url.searchParams.get("q")?.trim() ?? "",
    tag: url.searchParams.get("tag") ?? "",
    collection: url.searchParams.get("collection") ?? "",
    kind: url.searchParams.get("kind") ?? "",
    page: Number(url.searchParams.get("page") ?? "1") || 1,
  };
  const [results, tags, collections] = await Promise.all([
    services.catalog.browse(filters),
    services.catalog.listTags(),
    services.catalog.listCollections(),
  ]);
  return { results, tags, collections, filters };
}

function useFilterHref(change: Record<string, string | null>) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.delete("page");
  for (const [key, value] of Object.entries(change)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const search = next.toString();
  return search ? `/?${search}` : "/";
}

function Chip({ change, current, children }: { change: Record<string, string | null>; current: boolean; children: React.ReactNode }) {
  return (
    <Link to={useFilterHref(change)} className="chip" aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { results, tags, collections, filters } = loaderData;
  const { viewer } = useRootData();
  const isAdmin = Boolean(viewer?.isAdmin);
  const filtered = Boolean(filters.q || filters.tag || filters.collection || filters.kind);
  const activeCollection = collections.find((c) => c.id === filters.collection);
  const heading = filters.q
    ? `Results for “${filters.q}”`
    : activeCollection
      ? activeCollection.name
      : filters.tag
        ? `Tagged “${filters.tag}”`
        : filters.kind === "idea"
          ? "Ideas"
          : filters.kind === "recipe"
            ? "Recipes"
            : "All recipes";

  if (!filtered && results.total === 0) {
    return (
      <div className="empty">
        <h1>{isAdmin ? "A fresh notebook." : "No recipes yet."}</h1>
        {isAdmin ? (
          <>
            <p>Bring your recipes home from your AI chats. Start with your first one:</p>
            <div className="empty-actions">
              <Link to="/recipes/new" className="btn btn-primary">
                <PlusIcon />
                Add a recipe
              </Link>
              <Link to="/recipes/new?kind=idea" className="btn">
                Jot down an idea
              </Link>
            </div>
          </>
        ) : (
          <p>Check back soon.</p>
        )}
      </div>
    );
  }

  return (
    <div className="catalog">
      <nav className="browse" aria-label="Browse">
        <div>
          <h2 className="browse-title">Show</h2>
          <div className="browse-group">
            <Chip change={{ kind: null, tag: null, collection: null }} current={!filters.kind && !filters.tag && !filters.collection}>
              All
            </Chip>
            <Chip change={{ kind: "recipe" }} current={filters.kind === "recipe"}>
              Recipes
            </Chip>
            <Chip change={{ kind: "idea" }} current={filters.kind === "idea"}>
              Ideas
            </Chip>
          </div>
        </div>
        {collections.length > 0 && (
          <div>
            <h2 className="browse-title">Collections</h2>
            <div className="browse-group">
              {collections.map((collection) => (
                <Chip
                  key={collection.id}
                  change={{ collection: filters.collection === collection.id ? null : collection.id }}
                  current={filters.collection === collection.id}
                >
                  {collection.name}
                  <span className="count">{collection.count}</span>
                </Chip>
              ))}
            </div>
          </div>
        )}
        {tags.length > 0 && (
          <div>
            <h2 className="browse-title">Tags</h2>
            <div className="browse-group wrap">
              {tags.map((tag) => (
                <Chip
                  key={tag.id}
                  change={{ tag: filters.tag.toLowerCase() === tag.name.toLowerCase() ? null : tag.name }}
                  current={filters.tag.toLowerCase() === tag.name.toLowerCase()}
                >
                  {tag.name}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </nav>

      <section className="catalog-results" aria-labelledby="results-heading">
        <div className="results-head">
          <h1 id="results-heading">{heading}</h1>
          <p className="muted" aria-live="polite">
            {results.total === 1 ? "1 entry" : `${results.total} entries`}
          </p>
        </div>
        {results.total === 0 ? (
          <div className="empty">
            <h2>Nothing matches.</h2>
            <p>Try fewer words, or search ingredients and notes too.</p>
            <p>
              <Link to="/">Clear search and filters</Link>
            </p>
          </div>
        ) : (
          <ul className="entry-list">
            {results.items.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
        {results.pageCount > 1 && <Pager page={results.page} pageCount={results.pageCount} />}
      </section>
    </div>
  );
}

function Pager({ page, pageCount }: { page: number; pageCount: number }) {
  const [params] = useSearchParams();
  const hrefFor = (target: number) => {
    const next = new URLSearchParams(params);
    if (target === 1) next.delete("page");
    else next.set("page", String(target));
    const search = next.toString();
    return search ? `/?${search}` : "/";
  };
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 ? (
        <Link to={hrefFor(page - 1)} className="btn">
          Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="muted">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link to={hrefFor(page + 1)} className="btn">
          Older
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
