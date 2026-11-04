// "Favorite", "Made" and "Want to try" (M6, AC-056). Everyone sees the
// markers that are set (D3); only admins get buttons to change them.
import { useState } from "react";
import { useFetcher } from "react-router";
import type { MarkerAction, RecipeMarkers } from "../../server/core/markers";
import { BookmarkIcon, CheckIcon, StarIcon } from "./icons";

export interface MarkersView {
  favorite: boolean;
  wantToTry: boolean;
  madeCount: number;
  lastMadeAt: Date | null;
}

export function markersView(markers: RecipeMarkers): MarkersView {
  const last = markers.made[0]?.madeAt;
  return {
    favorite: markers.favorite,
    wantToTry: markers.wantToTry,
    madeCount: markers.made.length,
    lastMadeAt: last ? new Date(last) : null,
  };
}

export function shortDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** What the markers will be once a pending change lands (optimistic UI). */
function predict(view: MarkersView, action: MarkerAction | null): MarkersView {
  switch (action) {
    case "favorite_on":
      return { ...view, favorite: true };
    case "favorite_off":
      return { ...view, favorite: false };
    case "want_on":
      return { ...view, wantToTry: true };
    case "want_off":
      return { ...view, wantToTry: false };
    case "made_add":
      return { ...view, wantToTry: false, madeCount: view.madeCount + 1, lastMadeAt: new Date() };
    case "made_undo":
      return { ...view, madeCount: Math.max(0, view.madeCount - 1) };
    default:
      return view;
  }
}

/** Shared by the marker buttons and cooking mode's "Mark as made". */
export function useMarkerFetcher(saved: MarkersView) {
  const fetcher = useFetcher<{ markerError?: string }>({ key: "markers" });
  const pending = (fetcher.formData?.get("marker") as MarkerAction | null) ?? null;
  const view = predict(saved, pending);
  // One change at a time: a second tap while saving is ignored (buttons stay focusable).
  const send = (action: MarkerAction) => {
    if (fetcher.state !== "idle") return;
    void fetcher.submit({ marker: action }, { method: "post", preventScrollReset: true });
  };
  return { view, send, busy: fetcher.state !== "idle", error: fetcher.data?.markerError ?? null };
}

function madeLabel(count: number) {
  return count === 0 ? "Made it" : count === 1 ? "Made" : `Made ${count}×`;
}

export function MarkerBar({ saved, isAdmin }: { saved: MarkersView; isAdmin: boolean }) {
  if (!isAdmin) return <MarkerBadges view={saved} />;
  return <MarkerButtons saved={saved} />;
}

function MarkerBadges({ view }: { view: MarkersView }) {
  if (!view.favorite && !view.wantToTry && view.madeCount === 0) return null;
  return (
    <ul className="markers" aria-label="Feedback">
      {view.favorite && (
        <li className="marker marker-fav" data-on="true">
          <StarIcon fill="currentColor" />
          Favorite
        </li>
      )}
      {view.madeCount > 0 && (
        <li className="marker marker-made" data-on="true">
          <CheckIcon />
          {madeLabel(view.madeCount)}
          {view.lastMadeAt && <span className="marker-when">· last {shortDate(view.lastMadeAt)}</span>}
        </li>
      )}
      {view.wantToTry && (
        <li className="marker marker-want" data-on="true">
          <BookmarkIcon fill="currentColor" />
          Want to try
        </li>
      )}
    </ul>
  );
}

function MarkerButtons({ saved }: { saved: MarkersView }) {
  const { view, send, error } = useMarkerFetcher(saved);
  const [madeOpen, setMadeOpen] = useState(false);
  const made = view.madeCount > 0;

  return (
    <div className="markers-wrap">
      <div className="markers" role="group" aria-label="Feedback">
        <button
          type="button"
          className="marker marker-fav"
          aria-pressed={view.favorite}
          onClick={() => send(view.favorite ? "favorite_off" : "favorite_on")}
        >
          <StarIcon fill={view.favorite ? "currentColor" : "none"} />
          Favorite
        </button>
        <button
          type="button"
          className="marker marker-made"
          aria-pressed={made}
          aria-expanded={made ? madeOpen : undefined}
          aria-controls={made ? "made-panel" : undefined}
          onClick={() => (made ? setMadeOpen(!madeOpen) : send("made_add"))}
        >
          <CheckIcon />
          {madeLabel(view.madeCount)}
        </button>
        <button
          type="button"
          className="marker marker-want"
          aria-pressed={view.wantToTry}
          onClick={() => send(view.wantToTry ? "want_off" : "want_on")}
        >
          <BookmarkIcon fill={view.wantToTry ? "currentColor" : "none"} />
          Want to try
        </button>
      </div>
      {made && madeOpen && (
        <div id="made-panel" className="made-panel">
          {view.lastMadeAt && <span className="muted">Last made {shortDate(view.lastMadeAt)}</span>}
          <button type="button" className="btn btn-small" onClick={() => send("made_add")}>
            Made it again today
          </button>
          <button
            type="button"
            className="btn btn-small"
              onClick={() => {
              if (view.madeCount === 1) setMadeOpen(false);
              send("made_undo");
            }}
          >
            Undo last “made”
          </button>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
