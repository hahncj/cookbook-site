/**
 * Photo storage interface. Cloudflare uses an R2 binding; the alternative host
 * uses the local filesystem (or any S3-compatible store later). Only adapters
 * implement this; the rest of the app depends on the interface alone.
 */
export interface MediaStore {
  put(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null>;
  delete(key: string): Promise<void>;
  /** Cheap connectivity probe for /health. */
  ping(): Promise<void>;
}
