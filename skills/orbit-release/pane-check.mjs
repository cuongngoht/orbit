#!/usr/bin/env node
// The Claude Code pane's own tests (hooks/live-pane.tsx), by the host's own runner. `claude plugin test <dir>` runs
// every *.test.ts and *.test.tsx under <dir>, and this plugin's root holds Orbit Control's vitest files too, which the
// runner cannot load. So the pane is staged alone -- the manifest, the hooks, the contract -- into a scratch folder,
// tested there, and the folder removed. Exits with the runner's code. Its name matches none of `node --test`'s default
// patterns (`*-test.mjs` does): the suite must not need the `claude` CLI, which a CI runner has not got.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PARTS = [".claude-plugin/plugin.json", "hooks/hooks.json", "hooks/live-pane.tsx", "hooks/tests", "types"];

function staged() {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pane-"));
  for (const part of PARTS) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
  return dir;
}

function tested(dir) {
  const run = spawnSync("claude", ["plugin", "test", dir], { stdio: "inherit" });
  rmSync(dir, { recursive: true, force: true });
  return run.status ?? 1;
}

process.exitCode = tested(staged());
