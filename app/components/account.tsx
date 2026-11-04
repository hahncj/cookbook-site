import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { authClient } from "../auth-client";
import type { Viewer } from "../session.server";
import { ChevronDownIcon, GearIcon } from "./icons";

/**
 * E2: goes straight to Google and comes back to this page. Before the page
 * has loaded its scripts (or if the call fails) the link falls back to the
 * /sign-in page, which does the same thing with a button.
 */
export function SignInButton() {
  const location = useLocation();
  const here = location.pathname + location.search;
  const [pending, setPending] = useState(false);
  return (
    <Link
      to={`/sign-in?next=${encodeURIComponent(here)}`}
      className="btn header-sign-in"
      aria-disabled={pending || undefined}
      onClick={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        try {
          const result = await authClient.signIn.social({ provider: "google", callbackURL: here });
          if (result.error) throw new Error(result.error.message);
        } catch {
          // Show the full sign-in page, which explains what went wrong and can retry.
          window.location.href = `/sign-in?next=${encodeURIComponent(here)}`;
        }
      }}
    >
      {pending ? "Signing in…" : "Sign in"}
    </Link>
  );
}

/** Visitors reach Settings (Appearance) from a gear in the top bar (E3). */
export function SettingsGear() {
  return (
    <Link to="/settings" className="btn btn-icon" aria-label="Settings" title="Settings">
      <GearIcon />
    </Link>
  );
}

export function Avatar({ viewer, size = 32 }: { viewer: Viewer; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (viewer.name || viewer.email).trim().charAt(0).toUpperCase() || "?";
  if (viewer.image && !broken) {
    return (
      <img
        src={viewer.image}
        alt=""
        width={size}
        height={size}
        className="avatar"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="avatar avatar-initial" style={{ width: size, height: size }} aria-hidden="true">
      {initial}
    </span>
  );
}

/** E2: profile picture (and name on wider screens) opening a small menu. */
export function AccountMenu({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  // Close after navigating, on Escape, and on a tap or click outside.
  useEffect(() => setOpen(false), [location.key]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const displayName = viewer.name || viewer.email;
  return (
    <div className="account" ref={root}>
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account: ${displayName}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar viewer={viewer} />
        <span className="account-name" aria-hidden="true">
          {displayName}
        </span>
        <ChevronDownIcon className="icon account-chevron" />
      </button>
      <div id={panelId} className="account-panel" hidden={!open}>
        <div className="account-who">
          <strong>{displayName}</strong>
          <span className="muted">{viewer.email}</span>
          {!viewer.isAdmin && <span className="muted">You can browse, but only cookbook admins can make changes.</span>}
        </div>
        <ul className="account-links">
          <li>
            <Link to="/settings">Settings</Link>
          </li>
          <li>
            <button
              type="button"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                await authClient.signOut();
                window.location.href = "/";
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
