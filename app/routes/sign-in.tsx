import { useState } from "react";
import { authClient } from "../auth-client";

export function meta() {
  return [{ title: "Sign in · Cookbook" }];
}

export default function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    setError(null);
    const fail = (message: string) => {
      setPending(false);
      setError(message);
    };
    // Never leave the button stuck: if the server does not answer, let the
    // admin try again.
    const timer = setTimeout(() => fail("Sign-in is taking too long. Please try again."), 15_000);
    try {
      // When this page is reached from a connector's OAuth request, the
      // provider plugin carries the signed query along and resumes that flow
      // after Google sign-in; otherwise the admin lands back on the home page.
      const result = await authClient.signIn.social({ provider: "google", callbackURL: "/" });
      if (result.error) fail(result.error.message ?? "Sign-in failed. Only cookbook admin accounts can sign in.");
      // On success the client navigates to Google; the page unloads.
    } catch {
      fail("Could not reach the server. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
    }
  }

  return (
    <main>
      <h1>Admin sign-in</h1>
      <p>Only the cookbook's admin Google accounts can sign in. Anyone can browse without signing in.</p>
      <button type="button" onClick={signIn} disabled={pending}>
        {pending ? "Redirecting to Google…" : "Sign in with Google"}
      </button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
