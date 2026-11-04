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

/**
 * The search bar. Admins also get an AI toggle (M7): with it on, the box asks
 * Claude for NEW recipes (web finds and AI-written ones, shaped by the
 * preference profile) instead of searching the cookbook. That's a paid call,
 * so it is a POST that the server checks, never a plain page load.
 */
function HeaderSearch({ query, isAdmin }: { query: string; isAdmin: boolean }) {
  const location = useLocation();
  const navigation = useNavigation();
  const onDiscover = location.pathname === "/discover";
  const [ai, setAi] = useState(onDiscover);
  useEffect(() => setAi(onDiscover), [onDiscover]);
  const aiMode = isAdmin && ai;
  const finding = navigation.state === "submitting" && navigation.formAction === "/discover";
  return (
    <div className="header-search">
      <Form method={aiMode ? "post" : "get"} action={aiMode ? "/discover" : "/"} role="search" className={`search${isAdmin ? " search-with-ai" : ""}`}>
        <label htmlFor="site-search" className="visually-hidden">
          {aiMode ? "Describe new recipes to find with AI" : "Search recipes"}
        </label>
        {aiMode ? <SparkleIcon /> : <SearchIcon />}
        <input
          id="site-search"
          type="search"
          name="q"
          defaultValue={query}
          key={query}
          placeholder={aiMode ? "Find new recipes with AI, e.g. quick vegetarian dinner" : "Search titles, ingredients, notes"}
          maxLength={aiMode ? 500 : undefined}
          required={aiMode}
          readOnly={finding}
        />
        {isAdmin && (
          <button
            type="button"
            className={`ai-toggle${aiMode ? " ai-toggle-on" : ""}`}
            aria-pressed={aiMode}
            onClick={() => setAi((value) => !value)}
            title={aiMode ? "AI mode on: finds new recipes" : "Turn on AI mode to find new recipes"}
          >
            AI<span className="visually-hidden"> mode: find new recipes</span>
          </button>
        )}
      </Form>
      {finding && (
        <p className="ai-finding" role="status">
          Finding new recipes with AI. This can take up to a minute.
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
