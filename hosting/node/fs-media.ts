import { mkdir, readFile, rm, stat, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { MediaStore } from "../../server/adapters/media";

/** MediaStore on the local filesystem (alternative host and local development). */
export class FileMediaStore implements MediaStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error(`Invalid media key: ${key}`);
    return full;
  }

  async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body instanceof Uint8Array ? body : new Uint8Array(body));
    await writeFile(`${path}.type`, contentType);
  }

  async get(key: string) {
    const path = this.pathFor(key);
    try {
      const [data, info, contentType] = await Promise.all([
        readFile(path),
        stat(path),
        readFile(`${path}.type`, "utf8").catch(() => "application/octet-stream"),
      ]);
      return { body: new Blob([data]).stream(), contentType, size: info.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true });
    await rm(`${path}.type`, { force: true });
  }

  async ping(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root);
  }
}
