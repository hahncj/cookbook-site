import { useState } from "react";
import { redirect } from "react-router";
import { eq } from "drizzle-orm";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { oauthClient } from "../../server/db/auth-schema";
import { authClient } from "../auth-client";
import { servicesContext } from "../context";
import { getViewer } from "../session.server";
import type { Route } from "./+types/consent";

export function meta() {
  return [{ title: "Connect an AI tool · Cookbook" }];
}

function hostOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const url = new URL(request.url);
  const query = url.search.slice(1);
  const { secret } = await services.auth.$context;
  if (!query || !(await verifyOAuthQueryParams(query, secret))) {
    throw new Response("This connection request is invalid or has expired. Start again from your AI tool.", { status: 400 });
  }
  const viewer = await getViewer(request, services);
  if (!viewer) throw redirect(`/sign-in?${query}`);
  if (!viewer.isAdmin) throw new Response("Only cookbook admins can connect AI tools.", { status: 403 });

  const params = new URLSearchParams(query);
  const clientId = params.get("client_id") ?? "";
  const [client] = await services.db
    .select({ name: oauthClient.name, uri: oauthClient.uri, redirectUris: oauthClient.redirectUris })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  // The name is supplied by the tool itself; the domain shown beside it comes from
  // its CIMD document URL or its registered redirect, which is harder to fake.
  const redirectHost = Array.isArray(client?.redirectUris) ? hostOf(client.redirectUris[0]) : null;
  const domain = hostOf(clientId) ?? redirectHost ?? hostOf(client?.uri);
  return {
    name: client?.name?.trim() || "An AI tool",
    domain,
    email: viewer.email,
  };
}

export default function Consent({ loaderData }: Route.ComponentProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { name, domain, email } = loaderData;

  async function decide(accept: boolean) {
    setPending(true);
    setError(null);
    const result = await authClient.oauth2.consent({ accept });
    const target = (result.data as { url?: string } | null)?.url;
    if (target) {
      window.location.href = target;
      return;
    }
    setPending(false);
    setError(result.error?.message ?? "Could not complete the connection. Please try again from your AI tool.");
  }

  return (
    <div className="narrow">
      <h1>Connect {name} to your cookbook?</h1>
      <p className="muted">
        {name}
        {domain ? ` · ${domain}` : " · unknown website"}
      </p>
      <section className="card" aria-labelledby="can-heading">
        <h2 id="can-heading" style={{ fontFamily: "var(--font-body)", fontSize: 15, marginBottom: 8 }}>
          {name} will be able to
        </h2>
        <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
          <li>Read and search your recipes</li>
          <li>Send new recipes and changes for your review</li>
        </ul>
        <h2 style={{ fontFamily: "var(--font-body)", fontSize: 15, margin: "14px 0 6px" }}>It can't</h2>
        <p>Approve its own submissions, delete recipes, or change your settings.</p>
      </section>
      <p className="muted">Signed in as {email}. You can disconnect it from the AI tool's settings at any time.</p>
      <div style={{ display: "grid", gap: 10 }}>
        <button type="button" className="btn btn-primary btn-block" onClick={() => decide(true)} disabled={pending}>
          Allow
        </button>
        <button type="button" className="btn btn-block" onClick={() => decide(false)} disabled={pending}>
          Don't allow
        </button>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
