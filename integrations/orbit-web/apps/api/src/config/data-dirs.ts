// The persistent directories, created on start if missing and kept private to the runtime user (0700): the CLIs'
// sign-ins live in two of them.
import { randomBytes } from "node:crypto";
import { accessSync, chmodSync, constants, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DataDirs } from "./config.js";

export const PRIVATE_DIRS: (keyof DataDirs)[] = ["app", "claude", "github", "azure", "orbit", "sessions", "workspaces", "home", "governance", "repos", "control", "research"];

export function ensureDataDirs(data: DataDirs): void {
  mkdirSync(data.root, { recursive: true, mode: 0o700 });
  for (const key of PRIVATE_DIRS) {
    mkdirSync(data[key], { recursive: true, mode: 0o700 });
    try {
      chmodSync(data[key], 0o700);
    } catch {
      // A directory another user owns keeps its mode; the storage check reports whether it is writable.
    }
  }
  // The control plane's own HOME (governed deployment).
  mkdirSync(join(data.control, "home"), { recursive: true, mode: 0o700 });
}

// Whether every directory exists and can be written: a probe file is written and removed in each. The probe's name is
// new every time and it is CREATED exclusively (`wx`): a file -- or a link -- somebody left at that name is never
// written through, so a directory the agent can write cannot turn this check into a write somewhere else.
export function storageProblems(data: DataDirs): string[] {
  return PRIVATE_DIRS.flatMap((key) => {
    try {
      accessSync(data[key], constants.W_OK | constants.R_OK | constants.X_OK);
      const probe = join(data[key], `.orbit-web-probe-${randomBytes(8).toString("hex")}`);
      writeFileSync(probe, "ok", { flag: "wx", mode: 0o600 });
      rmSync(probe);
      return [];
    } catch {
      return [`${key} is not writable`];
    }
  });
}
