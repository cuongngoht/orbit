// THE BYTES of chat images, on the Orbit server under /data/app/images -- the control plane's own room, beside the
// database that names them (the agent's rules refuse it the room; the governed deployment never mounts it where the
// agent runs):
//
//   <image id>              an image, written whole, synced, then renamed into place
//   .<random>.part          one being written
//
// Every name is the server's -- an id it made, checked to be one; nothing a client typed becomes a path. Every path is
// checked to resolve inside the room, and a link is never followed.
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { open, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { isImageId } from "@orbit-web/contracts";
import { contained } from "../../common/workspace-path.js";

export class ImageFiles {
  constructor(private readonly root: string) {}

  path(id: string): string {
    if (!isImageId(id)) throw new Error("not an image id");
    const path = join(this.root, id);
    if (!contained(this.root, path)) throw new Error("an image path resolves outside the images room");
    return path;
  }

  async put(id: string, bytes: Buffer): Promise<void> {
    const dest = this.path(id);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const tmp = join(this.root, `.${randomUUID()}.part`);
    const handle = await open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, dest);
  }

  // Read whole, at the moment a run is given it (a few megabytes at most: IMAGE_LIMITS).
  read(id: string): Buffer {
    const path = this.path(id);
    if (lstatSync(path).isSymbolicLink()) throw new Error("a stored image is a link");
    return readFileSync(path);
  }

  async remove(ids: readonly string[]): Promise<void> {
    for (const id of ids) await rm(this.path(id), { force: true });
  }

  // The images kept here, and the leftovers of writes cut short, each with when it last changed (the sweep's view).
  async list(): Promise<{ name: string; image: boolean; changedMs: number }[]> {
    const names = await readdir(this.root).catch(() => [] as string[]);
    const entries = await Promise.all(
      names.map(async (name) => {
        const image = isImageId(name);
        if (!image && !/^\.[0-9a-f-]{36}\.part$/.test(name)) return null;
        const info = await stat(join(this.root, name)).catch(() => null);
        return info === null ? null : { name, image, changedMs: info.mtimeMs };
      }),
    );
    return entries.filter((e): e is { name: string; image: boolean; changedMs: number } => e !== null);
  }

  async removeLeftover(name: string): Promise<void> {
    if (!/^\.[0-9a-f-]{36}\.part$/.test(name)) return;
    const path = join(this.root, name);
    if (contained(this.root, path)) await rm(path, { force: true });
  }
}
