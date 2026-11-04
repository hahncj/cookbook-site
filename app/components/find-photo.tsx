import { useState } from "react";
import type { FindPhotosResult, PhotoCandidate } from "../../server/core/photo-finder";
import { PhotoPrepareError, uploadPhoto } from "../photo-prepare";
import { SearchIcon } from "./icons";

export interface FoundPhoto {
  id: string;
  credit: string | null;
}

interface Props {
  /** Read when the button is pressed, so it uses what's in the form now. */
  query: () => { title: string; sourceUrl: string; sourceName: string };
  onAdded: (photo: FoundPhoto) => void;
  onBusyChange?: (busy: boolean) => void;
  /** Button text; defaults to "Find a photo". */
  label?: string;
}

const SOURCE_LABEL: Record<PhotoCandidate["source"], string> = {
  page: "From the recipe's page",
  stock: "Stock photo",
  web: "From the web",
};

/**
 * Find a photo (E1): shows a few candidates from the recipe's source page and
 * stock photos (or the web, when those find nothing or the admin asks for
 * more). Nothing is added until the admin picks one, and nothing is saved
 * until they save the recipe or approve the submission (D2). The chosen photo
 * is resized in the browser like an upload and keeps its credit line.
 */
export function FindPhoto({ query, onAdded, onBusyChange, label = "Find a photo" }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState<PhotoCandidate[]>([]);
  const [webAvailable, setWebAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function search(more: boolean) {
    setOpen(true);
    setLoading(true);
    setMessage(null);
    if (!more) {
      setCandidates([]);
      setSelected(null);
    }
    const body = new FormData();
    const q = query();
    body.append("title", q.title);
    body.append("sourceUrl", q.sourceUrl);
    body.append("sourceName", q.sourceName);
    if (more) body.append("more", "1");
    try {
      const response = await fetch("/api/photos/find", { method: "POST", body });
      const result = (await response.json().catch(() => ({}))) as Partial<FindPhotosResult> & { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Couldn't look for photos. Try again.");
      const found = result.candidates ?? [];
      setCandidates((current) => (more ? [...current, ...found.filter((c) => !current.some((x) => x.imageUrl === c.imageUrl))] : found));
      setWebAvailable(Boolean(result.webAvailable));
      setMessage(result.message ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't look for photos. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function useSelected() {
    const chosen = candidates.find((c) => c.imageUrl === selected);
    if (!chosen) return;
    setAdding(true);
    onBusyChange?.(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("url", chosen.imageUrl);
      const response = await fetch("/api/photos/fetch", { method: "POST", body });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        throw new PhotoPrepareError(result.message ?? "Couldn't download that photo. Pick another one.");
      }
      const stored = await uploadPhoto(await response.blob(), chosen.credit);
      onAdded({ id: stored.id, credit: stored.credit });
      setOpen(false);
      setCandidates([]);
      setSelected(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The photo couldn't be added.");
    } finally {
      setAdding(false);
      onBusyChange?.(false);
    }
  }

  return (
    <>
      <button type="button" className="btn photo-pick" onClick={() => search(false)} disabled={loading || adding} aria-expanded={open}>
        <SearchIcon />
        {label}
      </button>
      {open && (
        <div className="find-photo" role="group" aria-label="Photo choices">
          {loading && candidates.length === 0 && <p className="hint">Looking for photos…</p>}
          {candidates.length > 0 && (
            <ul className="find-photo-grid">
              {candidates.map((candidate, index) => (
                <li key={candidate.imageUrl}>
                  <button
                    type="button"
                    className="find-photo-choice"
                    aria-pressed={selected === candidate.imageUrl}
                    onClick={() => setSelected(candidate.imageUrl)}
                  >
                    <img src={candidate.previewUrl} alt={candidate.description || `Photo choice ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" />
                    <span className={candidate.source === "web" ? "find-photo-source web" : "find-photo-source"}>{SOURCE_LABEL[candidate.source]}</span>
                    <span className="find-photo-credit">{candidate.credit}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {candidates.some((c) => c.source === "web") && (
            <p className="hint">Photos from the web are usually copyrighted. Only use one if you're comfortable doing so.</p>
          )}
          {message && (
            <p className="hint" role="status">
              {message}
            </p>
          )}
          <div className="photo-buttons">
            <button type="button" className="btn btn-primary" onClick={useSelected} disabled={!selected || adding || loading}>
              {adding ? "Adding photo…" : "Use this photo"}
            </button>
            {webAvailable && (
              <button type="button" className="btn" onClick={() => search(true)} disabled={loading || adding}>
                {loading ? "Searching…" : "Search the web for more"}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setOpen(false)} disabled={adding}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
