import { useState } from "react";
import { useSearchParams } from "react-router";
import { authClient } from "../auth-client";
import { safeReturnPath } from "../theme";

export function meta() {
  return [{ title: "Sign in · Cookbook" }];
}

export default function SignIn() {
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // An AI tool's connection request arrives with signed OAuth parameters; the
  // provider plugin resumes that flow after Google. Otherwise return to `next`.
  const next = safeReturnPath(params.get("next"));

  async function signIn() {
    setPending(true);
    setError(null);
    const timer = setTimeout(() => {
      setPending(false);
      setError("Sign-in is taking too long. Please try again.");
    }, 15_000);
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: next });
      if (result.error) {
        setPending(false);
        setError(result.error.message ?? "Sign-in failed. Only cookbook admin accounts can sign in.");
      }
    } catch {
      setPending(false);
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
    }
  }

  return (
    <div className="narrow">
      <h1>Admin sign-in</h1>
      <p className="muted">Only the cookbook's admin Google accounts can sign in. Anyone can browse without signing in.</p>
      <button type="button" className="btn btn-primary btn-block" onClick={signIn} disabled={pending}>
        {pending ? "Redirecting to Google…" : "Sign in with Google"}
      </button>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
