import { useRef, useState } from "react";
import { photoUrl, uploadPhoto } from "../photo-prepare";
import { CameraIcon, CloseIcon, UploadIcon } from "./icons";

interface Photo {
  id: string;
  caption: string;
}

/**
 * Photo list for the editor: take a photo (phone camera) or upload existing
 * photos and screenshots, add captions, reorder, remove. Uploads happen right
 * away; the order and captions are saved with the recipe. Saving a photo never
 * triggers AI analysis (AC-044).
 */
export function PhotoField({ initial, onBusyChange }: { initial: Photo[]; onBusyChange?: (busy: boolean) => void }) {
  const [photos, setPhotos] = useState<Photo[]>(initial);
  const [busy, setBusyCount] = useState(0);
  const setBusy = (update: (n: number) => number) =>
    setBusyCount((n) => {
      const next = update(n);
      onBusyChange?.(next > 0);
      return next;
    });
  const [error, setError] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const list = Array.from(files);
    setBusy((n) => n + list.length);
    for (const file of list) {
      try {
        const stored = await uploadPhoto(file);
        setPhotos((current) => [...current, { id: stored.id, caption: "" }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The photo couldn't be added.");
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (cameraInput.current) cameraInput.current.value = "";
    if (uploadInput.current) uploadInput.current.value = "";
  }

  const move = (index: number, delta: number) =>
    setPhotos((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });

  return (
    <fieldset>
      <legend>Photos</legend>
      {photos.length > 0 && (
        <ul className="photo-list">
          {photos.map((photo, index) => (
            <li key={photo.id} className="photo-item">
              <input type="hidden" name="photoId" value={photo.id} />
              <img src={photoUrl(photo.id, "thumb")} alt={photo.caption || `Photo ${index + 1}`} width={96} height={96} />
              <div className="photo-item-body">
                <label htmlFor={`caption-${photo.id}`} className="visually-hidden">
                  Caption for photo {index + 1}
                </label>
                <input
                  id={`caption-${photo.id}`}
                  className="input"
                  name="photoCaption"
                  value={photo.caption}
                  maxLength={200}
                  placeholder={index === 0 ? "Caption (this photo leads the recipe)" : "Caption (optional)"}
                  onChange={(event) =>
                    setPhotos((current) => current.map((p) => (p.id === photo.id ? { ...p, caption: event.target.value } : p)))
                  }
                />
                <div className="photo-item-actions">
                  <button type="button" className="btn" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move photo ${index + 1} earlier`}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => move(index, 1)}
                    disabled={index === photos.length - 1}
                    aria-label={`Move photo ${index + 1} later`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPhotos((current) => current.filter((p) => p.id !== photo.id))}
                    aria-label={`Remove photo ${index + 1}`}
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="photo-buttons">
        <label className="btn photo-pick">
          <CameraIcon />
          Take photo
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="visually-hidden"
            onChange={(event) => addFiles(event.target.files)}
          />
        </label>
        <label className="btn photo-pick">
          <UploadIcon />
          Upload photos
          <input
            ref={uploadInput}
            type="file"
            accept="image/*"
            multiple
            className="visually-hidden"
            onChange={(event) => addFiles(event.target.files)}
          />
        </label>
      </div>
      <p className="hint" aria-live="polite">
        {busy > 0
          ? `Adding ${busy === 1 ? "photo" : `${busy} photos`}…`
          : "Photos are resized and location data is removed. Adding a photo doesn't run any AI."}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
