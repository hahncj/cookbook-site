import { useState } from "react";
import { redirect } from "react-router";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { authClient } from "../auth-client";
import { servicesContext } from "../context";
import { getViewer } from "../session.server";
import type { Route } from "./+types/consent";

export function meta() {
  return [{ title: "Connect an AI tool · Cookbook" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const url = new URL(request.url);
  const query = url.search.slice(1);
  const { secret } = await services.auth.$context;
  if (!query || !(await verifyOAuthQueryParams(query, secret))) {
    throw new Response("This connection request is invalid or has expired.", { status: 400 });
  }
  const viewer = await getViewer(request, services);
  if (!viewer) throw redirect(`/sign-in?${query}`);
  if (!viewer.isAdmin) throw new Response("Only cookbook admins can connect AI tools.", { status: 403 });

  const params = new URLSearchParams(query);
  return {
    clientId: params.get("client_id") ?? "unknown client",
    scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
    email: viewer.email,
  };
}

export default function Consent({ loaderData }: Route.ComponentProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <main>
      <h1>Connect an AI tool</h1>
      <p>
        <strong>{loaderData.clientId}</strong> wants to connect to the cookbook as {loaderData.email}.
      </p>
      {loaderData.scopes.length > 0 && <p>Requested access: {loaderData.scopes.join(", ")}</p>}
      <p>
        <button type="button" onClick={() => decide(true)} disabled={pending}>
          Allow
        </button>{" "}
        <button type="button" onClick={() => decide(false)} disabled={pending}>
          Deny
        </button>
      </p>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
