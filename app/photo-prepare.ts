// Browser-side photo preparation: resize and re-encode before upload.
// Drawing to a canvas applies the photo's orientation and produces a fresh
// JPEG with no EXIF/GPS metadata. Keeps uploads small on phones and keeps the
// server's work (and the free plan's CPU limit) out of image processing.

export const FULL_MAX_EDGE = 2048;
export const THUMB_MAX_EDGE = 480;

export class PhotoPrepareError extends Error {}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoPrepareError("This browser can't read that photo. Try a JPEG or PNG, or take the photo again."));
    };
    img.src = url;
  });
}

function encode(img: HTMLImageElement, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoPrepareError("Could not process the photo on this device.");
  ctx.fillStyle = "#ffffff"; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PhotoPrepareError("Could not process the photo."))), "image/jpeg", quality),
  );
}

export async function preparePhoto(file: Blob): Promise<{ full: Blob; thumb: Blob }> {
  if (file.size > 40 * 1024 * 1024) throw new PhotoPrepareError("That photo is too large to process (40 MB maximum).");
  const img = await loadImage(file);
  if (!img.naturalWidth || !img.naturalHeight) throw new PhotoPrepareError("That photo appears to be empty.");
  const [full, thumb] = await Promise.all([encode(img, FULL_MAX_EDGE, 0.85), encode(img, THUMB_MAX_EDGE, 0.8)]);
  return { full, thumb };
}

/** Resizes and stores a photo. `credit` is only for photos chosen with Find a photo (E1). */
export async function uploadPhoto(file: Blob, credit?: string): Promise<{ id: string; width: number; height: number; credit: string | null }> {
  const { full, thumb } = await preparePhoto(file);
  const body = new FormData();
  body.append("full", full, "photo.jpg");
  body.append("thumb", thumb, "thumb.jpg");
  if (credit) body.append("credit", credit);
  const response = await fetch("/api/photos", { method: "POST", body });
  const result = (await response.json().catch(() => ({}))) as { id?: string; width?: number; height?: number; credit?: string | null; message?: string };
  if (!response.ok || !result.id) throw new PhotoPrepareError(result.message ?? "The photo couldn't be saved. Please try again.");
  return { id: result.id, width: result.width ?? 0, height: result.height ?? 0, credit: result.credit ?? null };
}

export const photoUrl = (id: string, size: "full" | "thumb" = "full") => `/media/photos/${id}${size === "thumb" ? "/thumb" : ""}`;
