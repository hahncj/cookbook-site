import { servicesContext } from "../context";
import { getViewer } from "../session.server";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "Cookbook" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  return { viewer: await getViewer(request, services) };
}

// M0 placeholder. The catalog and visual design arrive in M1/M2.
export default function Home({ loaderData }: Route.ComponentProps) {
  const { viewer } = loaderData;
  return (
    <main>
      <h1>Cookbook</h1>
      <p>The recipe catalog is coming soon.</p>
      {viewer ? (
        <p>
          Signed in as {viewer.email}
          {viewer.isAdmin ? " (admin)" : " (not an admin)"}.
        </p>
      ) : (
        <p>
          <a href="/sign-in">Admin sign-in</a>
        </p>
      )}
    </main>
  );
}
