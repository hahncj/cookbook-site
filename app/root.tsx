import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/public-sans/index.css";
import "./styles/app.css";

import {
  Form,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLocation,
  useNavigation,
  useRouteLoaderData,
  useSearchParams,
} from "react-router";
import { AccountMenu, FloatingAdd, SettingsGear, SignInButton } from "./components/account";
import { SearchIcon, SparkleIcon } from "./components/icons";
import { servicesContext } from "./context";
import { getViewer, type Viewer } from "./session.server";
import { useEffect, useState } from "react";
import { readTheme, type ThemePreference } from "./theme";
import type { Route } from "./+types/root";

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const viewer = await getViewer(request, services);
  return {
    viewer,
    theme: readTheme(request.headers.get("Cookie")),
    // Admins see how many AI submissions are waiting (never public, AC-070).
    pendingReviews: viewer?.isAdmin ? await services.submissions.countPending() : 0,
  };
}

export interface RootData {
  viewer: Viewer | null;
  theme: ThemePreference;
  pendingReviews: number;
}

export function useRootData(): RootData {
  return (useRouteLoaderData("root") as RootData | undefined) ?? { viewer: null, theme: "system", pendingReviews: 0 };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData("root") as RootData | undefined;
  const theme = data?.theme ?? "system";
  return (
    <html lang="en" data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* D10: keep the site out of search engines. */}
        <meta name="robots" content="noindex, nofollow" />
        <meta name="color-scheme" content={theme === "system" ? "light dark" : theme} />
        <link rel="icon" type="image/png" sizes="32x32" href="/brand/logo-32.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/brand/logo-192.png" />
        <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="apple-mobile-web-app-title" content="540 Kitchen" />
        <meta name="application-name" content="540 Kitchen" />
        <meta name="theme-color" content="#f7f4ec" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#171a21" media="(prefers-color-scheme: dark)" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function SiteHeader() {
  const { viewer, pendingReviews } = useRootData();
  const [params] = useSearchParams();
  const location = useLocation();
  const query = location.pathname === "/" ? (params.get("q") ?? "") : "";
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link to="/" className="brand">
          <img
            src="/brand/logo-96.png"
            srcSet="/brand/logo-96.png 2x, /brand/logo-144.png 3x"
            width={48}
            height={48}
            alt="540 Kitchen"
            className="brand-logo"
          />
          <span className="brand-name" aria-hidden="true">
            540 Kitchen
          </span>
        </Link>
        <HeaderSearch query={query} isAdmin={Boolean(viewer?.isAdmin)} />
        <div className="header-end">
          {viewer ? (
            <AccountMenu viewer={viewer} pendingReviews={pendingReviews} />
          ) : (
            <>
              <SettingsGear />
              <SignInButton />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

type SearchMode = "search" | "write" | "web";

/**
 * The search bar. Admins also get a small AI | Web toggle (M7, D21): with
 * one selected, the box asks Claude for NEW recipes instead of searching the
 * cookbook. AI writes them; Web finds real pages. Tapping the selected one
 * again goes back to normal search. That's a paid call, so it is a POST the
 * server checks, never a plain page load.
 */
function HeaderSearch({ query, isAdmin }: { query: string; isAdmin: boolean }) {
  const location = useLocation();
  const navigation = useNavigation();
  const onDiscover = location.pathname === "/discover";
  const [mode, setMode] = useState<SearchMode>("search");
  // On the results page, stay in the mode last used (remembered on this device).
  useEffect(() => {
    if (!onDiscover) return setMode("search");
    let last: SearchMode = "write";
    try {
      if (localStorage.getItem("aiSource") === "web") last = "web";
    } catch {
      // Storage unavailable: default to AI.
    }
    setMode(last);
  }, [onDiscover]);
  const choose = (next: "write" | "web") => {
    const value = mode === next ? "search" : next;
    setMode(value);
    if (value !== "search") {
      try {
        localStorage.setItem("aiSource", value);
      } catch {
        // Storage unavailable: nothing to remember.
      }
    }
  };
  const aiMode = isAdmin && mode !== "search";
  const finding = navigation.state === "submitting" && navigation.formAction === "/discover";
  const findingWeb = finding && navigation.formData?.get("source") === "web";
  const label = mode === "web" ? "Describe new recipes to find on the web" : mode === "write" ? "Describe new recipes for AI to write" : "Search recipes";
  const placeholder =
    mode === "web" ? "Find recipes on the web, e.g. fall stew" : mode === "write" ? "Describe a recipe for AI to write" : "Search titles, ingredients, notes";
  return (
    <div className="header-search">
      <Form method={aiMode ? "post" : "get"} action={aiMode ? "/discover" : "/"} role="search" className={`search${isAdmin ? " search-with-ai" : ""}`}>
        <label htmlFor="site-search" className="visually-hidden">
          {aiMode ? label : "Search recipes"}
        </label>
        {aiMode ? <SparkleIcon /> : <SearchIcon />}
        <input
          id="site-search"
          type="search"
          name="q"
          defaultValue={query}
          key={query}
          placeholder={aiMode ? placeholder : "Search titles, ingredients, notes"}
          maxLength={aiMode ? 500 : undefined}
          required={aiMode}
          readOnly={finding}
        />
        {aiMode && <input type="hidden" name="source" value={mode} />}
        {isAdmin && (
          <div className="ai-switch" role="group" aria-label="Find new recipes">
            <button
              type="button"
              aria-pressed={mode === "write"}
              aria-label="AI: write new recipes"
              onClick={() => choose("write")}
              title={mode === "write" ? "Back to searching your recipes" : "Have AI write new recipes"}
            >
              AI
            </button>
            <button
              type="button"
              aria-pressed={mode === "web"}
              aria-label="Web: find new recipes"
              onClick={() => choose("web")}
              title={mode === "web" ? "Back to searching your recipes" : "Find new recipes on the web"}
            >
              Web
            </button>
          </div>
        )}
      </Form>
      {finding && (
        <p className="ai-finding" role="status">
          {findingWeb ? "Searching the web for new recipes. This usually takes 15–30 seconds." : "Writing new recipes with AI. This takes about 20 seconds."}
        </p>
      )}
    </div>
  );
}

export default function App() {
  const { viewer } = useRootData();
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className={viewer?.isAdmin ? "container site-main has-fab" : "container site-main"}>
        <Outlet />
      </main>
      {viewer?.isAdmin && <FloatingAdd />}
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let detail = "Please try again in a moment.";
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Not found";
      detail = "That recipe isn't here. It may have been deleted.";
    } else {
      title = error.status === 401 || error.status === 403 ? "Not allowed" : `Error ${error.status}`;
      detail = typeof error.data === "string" && error.data ? error.data : detail;
    }
  }
  return (
    <>
      <SiteHeader />
      <main id="main" className="container site-main">
        <div className="empty">
          <h1>{title}</h1>
          <p>{detail}</p>
          <p>
            <Link to="/">Back to the cookbook</Link>
          </p>
        </div>
      </main>
    </>
  );
}
