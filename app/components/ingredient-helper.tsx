import { useId, useRef, useState } from "react";
import { preparePhoto } from "../photo-prepare";
import { CloseIcon, SparkleIcon } from "./icons";

interface Suggestion {
  name: string;
  confidence: "high" | "medium" | "low";
  note: string | null;
}

interface Props {
  /** Ids of photos currently in the editor (read when the button is pressed). */
  currentPhotoIds: () => string[];
  /** Ingredient names already in the editor, to skip duplicates. */
  currentItems: () => string[];
  /** Appends rows with blank amounts. Never changes existing rows (AC-047). */
  onAdd: (names: string[]) => void;
}

/**
 * "Identify ingredients" (AC-007, AC-045): photos, a description, or both.
 * Runs only when the admin presses the button. Suggestions are editable and
 * only reach the recipe through the editor and Save. Failures leave the form
 * untouched (AC-048).
 */
export function IngredientHelper({ currentPhotoIds, currentItems, onAdd }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [usePhotos, setUsePhotos] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<(Suggestion & { key: number; picked: boolean })[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function identify() {
    setError(null);
    setMessage(null);
    const photoIds = usePhotos ? currentPhotoIds().slice(0, 4) : [];
    if (photoIds.length === 0 && files.length === 0 && !description.trim()) {
      setError("Add a photo or describe the dish first.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      for (const file of files) body.append("image", (await preparePhoto(file)).full, "photo.jpg");
      for (const photoId of photoIds) body.append("photoId", photoId);
      if (description.trim()) body.append("description", description.trim());
      const response = await fetch("/api/ai/ingredients", { method: "POST", body });
      const result = (await response.json().catch(() => ({}))) as { suggestions?: Suggestion[]; message?: string | null };
      if (!response.ok || !result.suggestions) {
        setError(result.message ?? "Ingredient identification failed. Your recipe is unchanged; try again.");
        return;
      }
      const existing = new Set(currentItems().map((item) => item.trim().toLowerCase()));
      setSuggestions(
        result.suggestions.map((s, key) => ({ ...s, key, picked: s.confidence === "high" && !existing.has(s.name.toLowerCase()) })),
      );
      setMessage(result.suggestions.length === 0 ? (result.message ?? "No ingredients could be identified.") : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ingredient identification failed. Your recipe is unchanged; try again.");
    } finally {
      setBusy(false);
    }
  }

  function addPicked() {
    if (!suggestions) return;
    const existing = new Set(currentItems().map((item) => item.trim().toLowerCase()));
    const names = suggestions
      .filter((s) => s.picked && s.name.trim() && !existing.has(s.name.trim().toLowerCase()))
      .map((s) => s.name.trim());
    onAdd(names);
    setSuggestions(null);
    setMessage(names.length ? `Added ${names.length} ingredient${names.length === 1 ? "" : "s"} with blank amounts. Fill in amounts if you know them.` : "Nothing new to add.");
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <SparkleIcon />
        Identify ingredients with AI
      </button>
    );
  }

  return (
    <section className="card ai-helper" aria-labelledby={`${id}-title`}>
      <div className="ai-helper-head">
        <h3 id={`${id}-title`}>Identify ingredients</h3>
        <button type="button" className="btn" aria-label="Close ingredient identification" onClick={() => setOpen(false)}>
          <CloseIcon />
        </button>
      </div>
      <p className="hint">Use photos of the dish, a description, or both. Suggestions are names only; amounts stay blank.</p>
      <label className="check">
        <input type="checkbox" checked={usePhotos} onChange={(e) => setUsePhotos(e.target.checked)} />
        Use this recipe's photos
      </label>
      <div className="field">
        <label htmlFor={`${id}-file`}>
          Another photo <span className="optional">(optional, not saved)</span>
        </label>
        <input
          ref={fileInput}
          id={`${id}-file`}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 4))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-desc`}>
          Description <span className="optional">(optional)</span>
        </label>
        <textarea
          id={`${id}-desc`}
          rows={2}
          value={description}
          maxLength={4000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Spicy noodles with peanut sauce and crunchy vegetables"
        />
      </div>
      <div>
        <button type="button" className="btn btn-primary" onClick={identify} disabled={busy}>
          {busy ? "Identifying…" : "Identify"}
        </button>
      </div>
      <div aria-live="polite">
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {message && <p className="notice">{message}</p>}
      </div>
      {suggestions && suggestions.length > 0 && (
        <fieldset>
          <legend>Suggestions</legend>
          <p className="hint">Edit names and choose which to add. Unsure ones are marked and not chosen by default.</p>
          <ul className="suggestion-list">
            {suggestions.map((s, index) => (
              <li key={s.key}>
                <input
                  type="checkbox"
                  aria-label={`Add ${s.name || `suggestion ${index + 1}`}`}
                  checked={s.picked}
                  onChange={(e) => setSuggestions((list) => list!.map((x) => (x.key === s.key ? { ...x, picked: e.target.checked } : x)))}
                />
                <input
                  className="input"
                  aria-label={`Suggestion ${index + 1} name`}
                  value={s.name}
                  maxLength={200}
                  onChange={(e) => setSuggestions((list) => list!.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))}
                />
                {s.confidence !== "high" && (
                  <span className="unsure" title={s.note ?? undefined}>
                    Not sure{s.note ? `: ${s.note}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary" onClick={addPicked}>
            Add chosen to ingredients
          </button>
        </fieldset>
      )}
    </section>
  );
}
