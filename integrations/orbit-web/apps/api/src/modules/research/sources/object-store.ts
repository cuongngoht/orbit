// THE FILES research sources were read from, kept on the Orbit server under /data/research -- the control plane's room,
// never mounted where the agent runs, never in a workspace, a repository or the web app's files:
//
//   workspaces/<workspace id>/objects/<first two of the hash>/<sha-256 of the bytes>
//   tmp/<random>.part        a file being written: written whole, synced, then renamed into place
//
// Every name is the server's: a workspace's id (a UUID it made) and the content's hash -- nothing a client typed ever
// becomes part of a path. Identical bytes within a workspace are stored once. Every path is checked to resolve inside
// the root, and a link is never followed.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { open, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isResearchId } from "@orbit-web/contracts";
import { contained } from "../../../common/workspace-path.js";

const HASH = /^[0-9a-f]{64}$/;

export const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

export class ObjectStore {
  constructor(private readonly root: string) {}

  private workspaceDir(workspaceId: string): string {
    if (!isResearchId(workspaceId)) throw new Error("not a workspace id");
    return join(this.root, "workspaces", workspaceId);
  }

  path(workspaceId: string, hash: string): string {
    if (!HASH.test(hash)) throw new Error("not a content hash");
    const path = join(this.workspaceDir(workspaceId), "objects", hash.slice(0, 2), hash);
    if (!contained(this.root, path)) throw new Error("an object path resolves outside the research store");
    return path;
  }

  // Stores the bytes (once per workspace) and names them by their hash.
  async put(workspaceId: string, bytes: Buffer): Promise<{ hash: string; size: number; existed: boolean }> {
    const hash = sha256(bytes);
    const dest = this.path(workspaceId, hash);
    if (existsSync(dest)) return { hash, size: bytes.length, existed: true };
    const tmpDir = join(this.root, "tmp");
    mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    mkdirSync(join(this.workspaceDir(workspaceId), "objects", hash.slice(0, 2)), { recursive: true, mode: 0o700 });
    if (!contained(this.root, join(this.workspaceDir(workspaceId), "objects"))) throw new Error("the workspace's room resolves outside the research store");
    const tmp = join(tmpDir, `${randomUUID()}.part`);
    const handle = await open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, dest);
    return { hash, size: bytes.length, existed: false };
  }

  async read(workspaceId: string, hash: string): Promise<Buffer> {
    const path = this.path(workspaceId, hash);
    if (lstatSync(path).isSymbolicLink()) throw new Error("a stored file is a link");
    return readFile(path);
  }

  async remove(workspaceId: string, hash: string): Promise<void> {
    await rm(this.path(workspaceId, hash), { force: true });
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    const dir = this.workspaceDir(workspaceId);
    if (contained(this.root, dir)) await rm(dir, { recursive: true, force: true });
  }

  // What an interrupted write left behind (at start: nothing is being written then).
  async sweep(): Promise<void> {
    const tmpDir = join(this.root, "tmp");
    if (!existsSync(tmpDir)) return;
    for (const name of await readdir(tmpDir)) if (name.endsWith(".part")) await rm(join(tmpDir, name), { force: true });
  }
}
