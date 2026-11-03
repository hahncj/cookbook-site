import type { MediaStore } from "../../server/adapters/media";

/** In-memory MediaStore for tests. */
export class MemoryMediaStore implements MediaStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string) {
    this.objects.set(key, { bytes: body instanceof Uint8Array ? body : new Uint8Array(body), contentType });
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return { body: new Blob([object.bytes]).stream(), contentType: object.contentType, size: object.bytes.length };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async ping() {}
}
