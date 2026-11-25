// IMMUTABLE ARTIFACTS: the bytes of what employees hand in, kept by content (SHA-256) per account in the control plane's
// own room -- never mounted into a sandbox. Bytes are staged first (a temporary file written whole and fsynced), their
// hash verified, then renamed into place, and only then is the blob row written; a crash between leaves a staged file
// the sweep removes, never a row naming bytes that are not there. One blob per (account, hash): counted once per
// account, never shared across accounts (no tenant can learn what another stored).
import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../../config/config.js";
import { APP_CONFIG } from "../../../core/tokens.js";
import { Db } from "../../../infra/db/db.js";

const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Injectable()
export class ArtifactStore {
  readonly root: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(Db) private readonly db: Db,
  ) {
    this.root = join(config.data.root, "workforce", "artifacts");
  }

  private dir(orbitId: string): string {
    if (!UUID.test(orbitId)) throw new Error("an account id was expected");
    return join(this.root, orbitId);
  }

  // Stores the bytes (or finds them stored) and the blob row; returns their hash.
  async put(orbitId: string, bytes: Buffer): Promise<{ sha256: string; size: number }> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const objects = join(this.dir(orbitId), "objects", sha256.slice(0, 2));
    const target = join(objects, sha256);
    if (!existsSync(target)) {
      const tmp = join(this.dir(orbitId), "tmp");
      mkdirSync(objects, { recursive: true, mode: 0o700 });
      mkdirSync(tmp, { recursive: true, mode: 0o700 });
      const staged = join(tmp, `${randomUUID()}.part`);
      const fd = openSync(staged, "wx", 0o600);
      try {
        writeSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (createHash("sha256").update(readFileSync(staged)).digest("hex") !== sha256) {
        rmSync(staged, { force: true });
        throw new Error("the staged bytes did not match their hash");
      }
      renameSync(staged, target);
    }
    await this.db.query("INSERT INTO workforce.blobs (account_id, sha256, size, refcount, stored_at) VALUES ($1, $2, $3, 0, $4) ON CONFLICT (account_id, sha256) DO NOTHING", [orbitId, sha256, bytes.length, new Date().toISOString()]);
    return { sha256, size: bytes.length };
  }

  read(orbitId: string, sha256: string): Buffer | null {
    if (!HEX.test(sha256)) return null;
    const p = join(this.dir(orbitId), "objects", sha256.slice(0, 2), sha256);
    if (!existsSync(p) || !lstatSync(p).isFile()) return null;
    const bytes = readFileSync(p);
    return createHash("sha256").update(bytes).digest("hex") === sha256 ? bytes : null;
  }

  // Staged files older than `graceMs` that never became objects (a crash between staging and renaming).
  sweep(graceMs = 3600_000): number {
    let n = 0;
    if (!existsSync(this.root)) return 0;
    for (const account of readdirSync(this.root)) {
      const tmp = join(this.root, account, "tmp");
      if (!existsSync(tmp)) continue;
      for (const f of readdirSync(tmp)) {
        const p = join(tmp, f);
        if (Date.now() - statSync(p).mtimeMs > graceMs) {
          rmSync(p, { force: true });
          n += 1;
        }
      }
    }
    return n;
  }
}
