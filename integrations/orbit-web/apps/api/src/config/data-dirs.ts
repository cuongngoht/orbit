// The persistent directories, created on start if missing and kept private to the runtime user (0700): the CLIs'
// sign-ins live in two of them.
import { accessSync, chmodSync, constants, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DataDirs } from "./config.js";

export const PRIVATE_DIRS: (keyof DataDirs)[] = ["app", "claude", "github", "orbit", "sessions", "workspaces", "home"];

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
}

// Whether every directory exists and can be written: a probe file is written and removed in each.
export function storageProblems(data: DataDirs): string[] {
  return PRIVATE_DIRS.flatMap((key) => {
    try {
      accessSync(data[key], constants.W_OK | constants.R_OK | constants.X_OK);
      const probe = join(data[key], `.orbit-web-probe-${process.pid}`);
      writeFileSync(probe, "ok");
      rmSync(probe);
      return [];
    } catch {
      return [`${key} is not writable`];
    }
  });
}
